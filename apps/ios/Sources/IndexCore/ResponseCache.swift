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
    guard !snapshots.isProvisional else { throw APIError.sessionNotVerified }
    let version = snapshots.ticket(key)
    let existing = flights[key]
    let flight = existing ?? Flight(task: Task { try await operation() })
    if existing == nil { flights[key] = flight }
    do {
      let data = try await flight.task.value
      guard version == snapshots.ticket(key) else { throw Invalidated() }
      if flights[key]?.id == flight.id {
        flights[key] = nil
        guard snapshots.store(data, key: key, version: version) else { throw Invalidated() }
      }
      return data
    } catch {
      if flights[key]?.id == flight.id { flights[key] = nil }
      if version != snapshots.ticket(key) && (error is CancellationError || (error as? URLError)?.code == .cancelled) { throw Invalidated() }
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
  @discardableResult func clear() -> Bool {
    let erased = snapshots.clear()
    cancelFlights()
    return erased
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
  struct Ticket: Equatable, Sendable {
    let account: Int
    let resource: Int
  }
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
  private var provisional = false
  private var generation = 0
  private var revisions: [String: Int] = [:]
  // Files on disk for the accepted account, so a write only prunes once the folder is full.
  private var diskCount = 0
  private let capacity: Int
  private let maxAge: TimeInterval
  private let directory: URL?
  private var accountDirectory: URL? {
    guard let directory, let scope, let account else { return nil }
    return directory.appendingPathComponent(Self.hashed(scope)).appendingPathComponent(Self.hashed(account))
  }
  init(capacity: Int, maxAge: TimeInterval, directory: URL?) {
    self.capacity = capacity
    self.maxAge = min(maxAge, 7 * 24 * 60 * 60)
    self.directory = directory
  }
  var version: Int { lock.withLock { generation } }
  var isProvisional: Bool { lock.withLock { provisional } }
  var provisionalAccount: String? { lock.withLock { provisional ? account : nil } }
  private struct RememberedAccount: Codable {
    let format: Int
    let scope: String
    let account: String
  }
  /// Launch may read the last verified account's files, but cannot refresh or write
  /// them until get-session confirms that identity. Extensions never call this.
  func provision(scope: String) -> String? {
    lock.withLock {
      guard account == nil, let file = rememberedFile(scope),
        let data = try? Data(contentsOf: file),
        let remembered = try? PropertyListDecoder().decode(RememberedAccount.self, from: data),
        remembered.format == Self.format, remembered.scope == scope, !remembered.account.isEmpty else { return nil }
      generation += 1
      self.scope = scope
      account = remembered.account
      provisional = true
      return account
    }
  }
  func ticket(_ key: String) -> Ticket {
    lock.withLock {
      if revisions[key] == nil { revisions[key] = 0 }
      return Ticket(account: generation, resource: revisions[key]!)
    }
  }
  @discardableResult func accept(scope: String, account: String) -> Bool {
    lock.withLock {
      let changed = self.scope != scope || self.account != account
      let wasProvisional = provisional
      if changed {
        eraseAcceptedAccount()
        generation += 1
        self.scope = scope
        self.account = account
      }
      provisional = false
      // Only the verified identity selected by the transport may hydrate its files.
      // Remove sibling accounts left by an interrupted transition before reading.
      if changed || wasProvisional, let directory {
        let selected = accountDirectory!
        let server = selected.deletingLastPathComponent()
        if let servers = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
          for other in servers where other != server { try? FileManager.default.removeItem(at: other) }
        }
        if let children = try? FileManager.default.contentsOfDirectory(at: server, includingPropertiesForKeys: nil) {
          for child in children where child != selected && child != rememberedFile(scope) { try? FileManager.default.removeItem(at: child) }
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        pruneDisk(selected)
      }
      if let file = rememberedFile(scope) {
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        if let bytes = try? encoder.encode(RememberedAccount(format: Self.format, scope: scope, account: account)) {
          try? write(bytes, to: file)
        }
      }
      return changed || wasProvisional
    }
  }
  func snapshot(_ key: String) -> Entry? {
    lock.withLock {
      var entry = entries[key]
      if entry == nil, let url = fileURL(key), let data = try? Data(contentsOf: url) {
        entry = try? PropertyListDecoder().decode(Entry.self, from: data)
        if entry == nil { removeLocked(key) }
      }
      guard let entry else { return nil }
      guard maxAge > 0, entry.format == Self.format, entry.scope == (scope ?? ""), entry.account == (account ?? ""), entry.key == key,
        Date().timeIntervalSince(entry.stored) >= -60, Date().timeIntervalSince(entry.stored) < maxAge else {
        removeLocked(key)
        return nil
      }
      remember(entry)
      return entry
    }
  }
  @discardableResult func store(_ data: Data, key: String, version: Ticket) -> Bool {
    lock.withLock {
      guard !provisional, version == Ticket(account: generation, resource: revisions[key] ?? 0) else { return false }
      let entry = Entry(format: Self.format, scope: scope ?? "", account: account ?? "", key: key, stored: .now, data: data)
      remember(entry)
      // Written under the lock so an account transition can never be followed by a late
      // write of the previous account's file.
      if let file = fileURL(key) {
        let folder = file.deletingLastPathComponent()
        do {
          let encoder = PropertyListEncoder()
          encoder.outputFormat = .binary
          let bytes = try encoder.encode(entry)
          let added = !FileManager.default.fileExists(atPath: file.path)
          try write(bytes, to: file)
          if added { diskCount += 1 }
          if diskCount > capacity { pruneDisk(folder) }
        } catch {
          // Persistence is best effort; memory remains usable when the device is locked
          // or storage is full. A partial write is never a usable envelope.
        }
      }
      return true
    }
  }
  func remove(_ key: String) { lock.withLock { revisions[key, default: 0] += 1; removeLocked(key) } }
  func invalidate(_ prefixes: [String]) {
    lock.withLock {
      for key in Array(revisions.keys) where prefixes.contains(where: { ResponseCache.matches(key, $0) }) { revisions[key, default: 0] += 1 }
      for key in Array(entries.keys) where prefixes.contains(where: { ResponseCache.matches(key, $0) }) { removeLocked(key) }
      // Filenames encode their keys, so finding affected files reads no file contents.
      if let folder = accountDirectory,
        let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
        for file in files {
          guard let key = Self.key(of: file) else { try? FileManager.default.removeItem(at: file); continue }
          if prefixes.contains(where: { ResponseCache.matches(key, $0) }) {
            try? FileManager.default.removeItem(at: file)
            diskCount -= 1
          }
        }
      }
    }
  }
  @discardableResult func clear() -> Bool {
    lock.withLock {
      generation += 1
      eraseAcceptedAccount()
      // Also erase files when no session has been accepted yet (e.g. expired restore).
      var erased = true
      if let directory, FileManager.default.fileExists(atPath: directory.path) {
        do { try FileManager.default.removeItem(at: directory) } catch { erased = false }
      }
      scope = nil
      account = nil
      provisional = false
      return erased
    }
  }
  private func eraseAcceptedAccount() {
    entries.removeAll()
    revisions.removeAll()
    diskCount = 0
    if let folder = accountDirectory { try? FileManager.default.removeItem(at: folder) }
    if let scope, let file = rememberedFile(scope) { try? FileManager.default.removeItem(at: file) }
  }
  private func rememberedFile(_ scope: String) -> URL? {
    directory?.appendingPathComponent(Self.hashed(scope)).appendingPathComponent("verified-account")
  }
  private func write(_ bytes: Data, to file: URL) throws {
    var folder = file.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try folder.setResourceValues(values)
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: folder.path)
    try bytes.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    #else
    try bytes.write(to: file, options: .atomic)
    #endif
  }
  private func removeLocked(_ key: String) {
    entries[key] = nil
    guard !provisional else { return }
    if let file = fileURL(key), (try? FileManager.default.removeItem(at: file)) != nil { diskCount -= 1 }
  }
  private func remember(_ entry: Entry) {
    if entries[entry.key] == nil, entries.count >= capacity,
      let oldest = entries.min(by: { $0.value.stored < $1.value.stored })?.key { entries[oldest] = nil }
    entries[entry.key] = entry
  }
  /// Uses only directory metadata: expired and surplus files go, oldest first. Envelopes are
  /// checked when read, so pruning never decodes payloads.
  private func pruneDisk(_ folder: URL) {
    let dates: Set<URLResourceKey> = [.contentModificationDateKey]
    guard let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: Array(dates)) else {
      diskCount = 0
      return
    }
    var kept: [(file: URL, modified: Date)] = []
    for file in files {
      let modified = (try? file.resourceValues(forKeys: dates).contentModificationDate) ?? .distantPast
      if Self.key(of: file) == nil || Date().timeIntervalSince(modified) >= maxAge {
        try? FileManager.default.removeItem(at: file)
      } else {
        kept.append((file, modified))
      }
    }
    kept.sort { $0.modified > $1.modified }
    for surplus in kept.dropFirst(capacity) { try? FileManager.default.removeItem(at: surplus.file) }
    diskCount = min(kept.count, capacity)
  }
  private static let format = 2
  private static let fileExtension = "plist"
  /// The key itself, base64url-encoded, so invalidation can match files without opening them.
  private func fileURL(_ key: String) -> URL? {
    guard Self.persists(key), let folder = accountDirectory else { return nil }
    let name = Data(key.utf8).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    // Long keys would exceed filename limits; they stay in memory only.
    guard name.utf8.count <= 240 else { return nil }
    return folder.appendingPathComponent(name).appendingPathExtension(Self.fileExtension)
  }
  private static func key(of file: URL) -> String? {
    guard file.pathExtension == fileExtension else { return nil }
    var name = file.deletingPathExtension().lastPathComponent
      .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    name += String(repeating: "=", count: (4 - name.count % 4) % 4)
    return Data(base64Encoded: name).flatMap { String(data: $0, encoding: .utf8) }
  }
  private static func hashed(_ value: String) -> String {
    // A stable folder name; the envelope's identity check protects against collisions.
    let hash = value.utf8.reduce(UInt64(14695981039346656037)) { ($0 ^ UInt64($1)) &* 1099511628211 }
    return String(hash, radix: 16)
  }
  private static func persists(_ key: String) -> Bool {
    !key.contains("query=") && !key.hasPrefix("/discovery/users") && !key.hasPrefix("/me/notifications")
      && !key.hasPrefix("/me/pulse") && !key.hasPrefix("/me/messages/unread") && !key.hasPrefix("/resolve")
  }
}
