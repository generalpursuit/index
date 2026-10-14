import Foundation

/// In-flight reads stay actor-owned; snapshots use a lock so a view can render them in
/// its initializer. Disk I/O is bounded to a small response cache, never credentials.
actor ResponseCache {
  struct Invalidated: Error {}
  private struct Flight {
    let id = UUID()
    let task: Task<Data, Error>
  }
  nonisolated let snapshots: ResponseSnapshots
  private var flights: [String: Flight] = [:]

  init(capacity: Int = 128, maxAge: TimeInterval = 7 * 24 * 60 * 60, directory: URL? = nil) {
    snapshots = ResponseSnapshots(capacity: capacity, maxAge: maxAge, directory: directory)
  }
  nonisolated func snapshot(_ key: String) -> Data? { snapshots.snapshot(key)?.data }
  func load(_ key: String, operation: @escaping @Sendable () async throws -> Data) async throws -> Data {
    let version = snapshots.version
    let existing = flights[key]
    let flight = existing ?? Flight(task: Task { try await operation() })
    if existing == nil { flights[key] = flight }
    do {
      let data = try await flight.task.value
      guard version == snapshots.version else { throw Invalidated() }
      if flights[key]?.id == flight.id {
        flights[key] = nil
        guard snapshots.store(data, key: key, version: version) else { throw Invalidated() }
      }
      return data
    } catch {
      if flights[key]?.id == flight.id { flights[key] = nil }
      if version != snapshots.version && (error is CancellationError || (error as? URLError)?.code == .cancelled) { throw Invalidated() }
      throw error
    }
  }
  func remove(_ key: String) { snapshots.remove(key) }
  func invalidate(_ prefixes: [String]) {
    guard !prefixes.isEmpty else { return }
    // Fence reads before canceling. Even transports ignoring cancellation cannot write
    // an old response over an optimistic edit. Unrelated snapshots remain readable.
    snapshots.invalidate(prefixes)
    for (key, flight) in flights where prefixes.contains(where: { Self.matches(key, $0) }) {
      flight.task.cancel()
      flights[key] = nil
    }
  }
  func accept(scope: String, account: String) {
    if snapshots.accept(scope: scope, account: account) { cancelFlights() }
  }
  func clear() {
    snapshots.clear()
    cancelFlights()
  }
  private func cancelFlights() {
    for flight in flights.values { flight.task.cancel() }
    flights.removeAll()
  }
  nonisolated static func matches(_ key: String, _ prefix: String) -> Bool {
    key == prefix || key.hasPrefix(prefix + "/") || key.hasPrefix(prefix + "?")
  }
}

/// The envelope repeats scope/account/key so filenames never grant identity or access.
/// A mismatched or expired envelope is discarded before its payload is decoded.
final class ResponseSnapshots: @unchecked Sendable {
  struct Entry: Codable {
    let format: Int
    let scope: String
    let account: String
    let key: String
    let stored: Date
    let data: Data
  }
  private let lock = NSLock()
  private var entries: [String: Entry] = [:]
  private var scope: String?
  private var account: String?
  private var generation = 0
  private let capacity: Int
  private let maxAge: TimeInterval
  private let directory: URL?
  private var accountDirectory: URL? {
    guard let directory, let scope, let account else { return nil }
    return directory.appendingPathComponent(Self.filename(scope)).appendingPathComponent(Self.filename(account))
  }
  init(capacity: Int, maxAge: TimeInterval, directory: URL?) {
    self.capacity = capacity
    self.maxAge = min(maxAge, 7 * 24 * 60 * 60)
    self.directory = directory
  }
  var version: Int { lock.withLock { generation } }
  @discardableResult func accept(scope: String, account: String) -> Bool {
    lock.withLock {
      guard self.scope != scope || self.account != account else { return false }
      eraseAcceptedAccount()
      generation += 1
      self.scope = scope
      self.account = account
      // Only the verified identity selected by the transport may hydrate its files.
      // Remove sibling accounts left by an interrupted transition before reading.
      if let directory {
        let selected = accountDirectory!
        let server = selected.deletingLastPathComponent()
        if let children = try? FileManager.default.contentsOfDirectory(at: server, includingPropertiesForKeys: nil) {
          for child in children where child != selected { try? FileManager.default.removeItem(at: child) }
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        pruneDisk(selected)
      }
      return true
    }
  }
  func snapshot(_ key: String) -> Entry? {
    lock.withLock {
      var entry = entries[key]
      if entry == nil, Self.persists(key), let url = accountDirectory?.appendingPathComponent(Self.filename(key)),
        let data = try? Data(contentsOf: url) {
        entry = try? JSONDecoder().decode(Entry.self, from: data)
      }
      guard let entry else { return nil }
      guard maxAge > 0, entry.format == 1, entry.scope == (scope ?? ""), entry.account == (account ?? ""), entry.key == key,
        Date().timeIntervalSince(entry.stored) >= -60, Date().timeIntervalSince(entry.stored) < maxAge else {
        removeLocked(key)
        return nil
      }
      remember(entry)
      return entry
    }
  }
  @discardableResult func store(_ data: Data, key: String, version: Int) -> Bool {
    lock.withLock {
      guard version == generation else { return false }
      let entry = Entry(format: 1, scope: scope ?? "", account: account ?? "", key: key, stored: .now, data: data)
      remember(entry)
      if Self.persists(key), let folder = accountDirectory {
        do {
          try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
          var protectedFolder = folder
          var values = URLResourceValues()
          values.isExcludedFromBackup = true
          try protectedFolder.setResourceValues(values)
          let file = folder.appendingPathComponent(Self.filename(key))
          let bytes = try JSONEncoder().encode(entry)
          #if os(iOS)
          try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: folder.path)
          try bytes.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
          #else
          try bytes.write(to: file, options: .atomic)
          #endif
          pruneDisk(folder)
        } catch {
          // Persistence is best effort; memory remains usable when the device is locked
          // or storage is full. A partial write is never a usable envelope.
        }
      }
      return true
    }
  }
  func remove(_ key: String) { lock.withLock { removeLocked(key) } }
  func invalidate(_ prefixes: [String]) {
    lock.withLock {
      generation += 1
      for key in Array(entries.keys) where prefixes.contains(where: { ResponseCache.matches(key, $0) }) { removeLocked(key) }
      if let folder = accountDirectory,
        let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
        for file in files {
          guard let bytes = try? Data(contentsOf: file), let entry = try? JSONDecoder().decode(Entry.self, from: bytes) else {
            try? FileManager.default.removeItem(at: file); continue
          }
          if prefixes.contains(where: { ResponseCache.matches(entry.key, $0) }) { try? FileManager.default.removeItem(at: file) }
        }
      }
    }
  }
  func clear() {
    lock.withLock {
      generation += 1
      eraseAcceptedAccount()
      // Also erase files when no session has been accepted yet (e.g. expired restore).
      if let directory { try? FileManager.default.removeItem(at: directory) }
      scope = nil
      account = nil
    }
  }
  private func eraseAcceptedAccount() {
    entries.removeAll()
    if let folder = accountDirectory { try? FileManager.default.removeItem(at: folder) }
  }
  private func removeLocked(_ key: String) {
    entries[key] = nil
    if let file = accountDirectory?.appendingPathComponent(Self.filename(key)) { try? FileManager.default.removeItem(at: file) }
  }
  private func remember(_ entry: Entry) {
    if entries[entry.key] == nil, entries.count >= capacity,
      let oldest = entries.min(by: { $0.value.stored < $1.value.stored })?.key { entries[oldest] = nil }
    entries[entry.key] = entry
  }
  private func pruneDisk(_ folder: URL) {
    guard let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
    for file in files {
      guard let bytes = try? Data(contentsOf: file), let entry = try? JSONDecoder().decode(Entry.self, from: bytes),
        entry.format == 1, entry.scope == scope, entry.account == account,
        Date().timeIntervalSince(entry.stored) < maxAge else {
        try? FileManager.default.removeItem(at: file)
        continue
      }
    }
    let ordered = files.filter { FileManager.default.fileExists(atPath: $0.path) }.sorted {
      ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
        < ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
    }
    for file in ordered.prefix(max(0, ordered.count - capacity)) { try? FileManager.default.removeItem(at: file) }
  }
  private static func filename(_ value: String) -> String {
    // A stable filename, with envelope identity checks protecting against collisions.
    let hash = value.utf8.reduce(UInt64(14695981039346656037)) { ($0 ^ UInt64($1)) &* 1099511628211 }
    return String(hash, radix: 16) + ".json"
  }
  private static func persists(_ key: String) -> Bool {
    !key.contains("query=") && !key.hasPrefix("/discovery/users") && !key.hasPrefix("/me/notifications")
      && !key.hasPrefix("/me/pulse") && !key.hasPrefix("/me/messages/unread") && !key.hasPrefix("/resolve")
  }
}
