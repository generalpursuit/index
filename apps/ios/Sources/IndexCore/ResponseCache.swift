import Foundation

/// Account-local snapshots and shared in-flight reads. Views may show a snapshot while
/// requesting a refresh; failures never turn yesterday's data into a successful response.
actor ResponseCache {
  struct Invalidated: Error {}
  private struct Entry {
    let data: Data
    let stored: Date
  }
  private struct Flight {
    let id = UUID()
    let task: Task<Data, Error>
  }
  private var entries: [String: Entry] = [:]
  private var flights: [String: Flight] = [:]
  private var generation = 0
  private let capacity: Int
  private let maxAge: TimeInterval

  init(capacity: Int = 128, maxAge: TimeInterval = 300) {
    self.capacity = capacity
    self.maxAge = maxAge
  }
  func snapshot(_ key: String) -> Data? {
    guard let entry = entries[key] else { return nil }
    guard Date().timeIntervalSince(entry.stored) < maxAge else {
      entries[key] = nil
      return nil
    }
    return entry.data
  }
  func load(_ key: String, operation: @escaping @Sendable () async throws -> Data) async throws
    -> Data
  {
    let version = generation
    let existing = flights[key]
    let flight = existing ?? Flight(task: Task { try await operation() })
    if existing == nil { flights[key] = flight }
    do {
      let data = try await flight.task.value
      guard version == generation else { throw Invalidated() }
      if flights[key]?.id == flight.id {
        flights[key] = nil
        if entries[key] == nil, entries.count >= capacity,
          let oldest = entries.min(by: { $0.value.stored < $1.value.stored })?.key
        {
          entries[oldest] = nil
        }
        entries[key] = Entry(data: data, stored: Date())
      }
      return data
    } catch {
      if flights[key]?.id == flight.id { flights[key] = nil }
      if version != generation
        && (error is CancellationError || (error as? URLError)?.code == .cancelled)
      {
        throw Invalidated()
      }
      throw error
    }
  }
  func remove(_ key: String) { entries[key] = nil }
  func clear() {
    generation += 1
    entries.removeAll()
    for flight in flights.values { flight.task.cancel() }
    flights.removeAll()
  }
}
