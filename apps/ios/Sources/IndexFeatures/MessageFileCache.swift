import Foundation
import IndexCore

/// Sent files' bytes and their Quick Look copies. Bytes stay in memory for the session while
/// the cache has room. Copies share one temporary folder, which a new cache and `clear()`
/// delete whole: only one account store, and so one cache, exists at a time, and no copy may
/// reach another session or account, even after the app was killed.
@MainActor
final class MessageFileCache {
  private let bytes: NSCache<NSString, NSData> = {
    let cache = NSCache<NSString, NSData>()
    cache.totalCostLimit = 100 * 1024 * 1024
    return cache
  }()
  private let folder = FileManager.default.temporaryDirectory.appending(path: "message-files", directoryHint: .isDirectory)
  /// Running downloads, and how many of the callers waiting for each are not cancelled.
  private var downloads: [String: (task: Task<Data, any Error>, wanted: Int)] = [:]

  init() { try? FileManager.default.removeItem(at: folder) }

  /// Keeps bytes this device already has, such as the sender's own files.
  func keep(_ data: Data, for id: String) {
    bytes.setObject(data as NSData, forKey: id as NSString, cost: data.count)
  }
  /// A file's bytes, kept or else downloaded and kept. Callers share a running download, as a
  /// thumbnail and Quick Look do when a photo opens while it loads. It stops once every caller
  /// waiting for it is cancelled, as when thumbnails scroll away.
  func data(for id: String, download: @escaping @MainActor () async throws -> Data) async throws -> Data {
    if let kept = bytes.object(forKey: id as NSString) { return kept as Data }
    let task = downloads[id]?.task ?? Task {
      let data = try await download()
      // A download that `clear()` or its callers stopped keeps nothing.
      try Task.checkCancellation()
      keep(data, for: id)
      return data
    }
    downloads[id, default: (task, 0)].wanted += 1
    defer { if downloads[id]?.task == task { downloads[id] = nil } }
    return try await withTaskCancellationHandler { try await task.value } onCancel: {
      Task { @MainActor in self.callerCancelled(id, task) }
    }
  }
  /// Stops a download once no caller wants it any more.
  private func callerCancelled(_ id: String, _ task: Task<Data, any Error>) {
    guard let running = downloads[id], running.task == task else { return }
    if running.wanted > 1 { downloads[id]?.wanted -= 1 } else { task.cancel(); downloads[id] = nil }
  }
  /// A private copy under the file's own name, for Quick Look.
  func previewURL(for file: MessageFile, load: () async throws -> Data) async throws -> URL {
    // The ID names a folder, so only a UUID, as the server issues, may build the path.
    guard UUID(uuidString: file.id) != nil else { throw APIError.invalidResponse }
    let copy = folder.appending(path: file.id, directoryHint: .isDirectory)
    let url = copy.appending(path: Self.diskName(for: file.name))
    if !FileManager.default.fileExists(atPath: url.path) {
      let data = try await load()
      try FileManager.default.createDirectory(at: copy, withIntermediateDirectories: true)
      // Like the response cache, macOS writes without a protection class, which it refuses here.
      #if os(iOS)
      try data.write(to: url, options: [.atomic, .completeFileProtection])
      #else
      try data.write(to: url, options: .atomic)
      #endif
    }
    return url
  }
  func clear() {
    for running in downloads.values { running.task.cancel() }
    downloads = [:]
    bytes.removeAllObjects()
    try? FileManager.default.removeItem(at: folder)
  }

  /// Disk names are at most 255 bytes and a leading dot hides a file. Names may be 200
  /// characters, so long ones lose the end of their stem but keep a usual extension, which
  /// Quick Look needs to recognize the kind.
  private static func diskName(for name: String) -> String {
    let name = name.replacingOccurrences(of: "/", with: "-")
    guard !name.isEmpty, !name.hasPrefix(".") else { return "File" }
    let kind = (name as NSString).pathExtension
    let suffix = kind.isEmpty || kind.utf8.count > 16 ? "" : "." + kind
    var stem = suffix.isEmpty ? name : (name as NSString).deletingPathExtension
    while stem.utf8.count + suffix.utf8.count > 200 { stem.removeLast() }
    return stem + suffix
  }
}
