import Foundation
import Testing

@testable import IndexCore

private actor ReadProbe {
  var count = 0
  private var continuation: CheckedContinuation<Data, Never>?
  func read() async -> Data {
    count += 1
    return await withCheckedContinuation { continuation = $0 }
  }
  func finish() {
    continuation?.resume(returning: Data("fresh".utf8))
    continuation = nil
  }
}
struct ResponseCacheTests {
  @Test func sharesConcurrentReadsAndRetainsSnapshot() async throws {
    let cache = ResponseCache()
    let probe = ReadProbe()
    let first = Task { try await cache.load("post") { await probe.read() } }
    while await probe.count == 0 { await Task.yield() }
    let second = Task { try await cache.load("post") { await probe.read() } }
    // Both consumers must be waiting on the same suspended read.
    for _ in 0..<50 { await Task.yield() }
    #expect(await probe.count == 1)
    await probe.finish()
    #expect(try await first.value == Data("fresh".utf8))
    #expect(try await second.value == Data("fresh".utf8))
    #expect(await cache.snapshot("post") == Data("fresh".utf8))
  }
  @Test func logoutRejectsLateResultsAndErasesSnapshots() async throws {
    let cache = ResponseCache()
    let probe = ReadProbe()
    let _ = try await cache.load("existing") { Data("private".utf8) }
    let late = Task { try await cache.load("late") { await probe.read() } }
    while await probe.count == 0 { await Task.yield() }
    await cache.clear()
    await probe.finish()  // A transport may complete even after cancellation.
    await #expect(throws: ResponseCache.Invalidated.self) { try await late.value }
    #expect(await cache.snapshot("existing") == nil)
    #expect(await cache.snapshot("late") == nil)
  }
  @Test func targetedInvalidationRejectsOnlyAffectedFlights() async throws {
    let cache = ResponseCache()
    let post = ReadProbe()
    let chat = ReadProbe()
    let changed = Task { try await cache.load("/links/a") { await post.read() } }
    let unchanged = Task { try await cache.load("/conversations/a") { await chat.read() } }
    while await post.count == 0 { await Task.yield() }
    while await chat.count == 0 { await Task.yield() }
    await cache.invalidate(["/links"])
    await post.finish()
    await chat.finish()
    await #expect(throws: ResponseCache.Invalidated.self) { try await changed.value }
    #expect(try await unchanged.value == Data("fresh".utf8))
    #expect(cache.snapshot("/links/a") == nil)
    #expect(cache.snapshot("/conversations/a") == Data("fresh".utf8))
  }
  @Test func failedRefreshRetainsSnapshotButStillThrows() async throws {
    let cache = ResponseCache()
    let _ = try await cache.load("post") { Data("known".utf8) }
    await #expect(throws: URLError.self) {
      try await cache.load("post") { throw URLError(.notConnectedToInternet) }
    }
    #expect(await cache.snapshot("post") == Data("known".utf8))
  }
  @Test func snapshotsExpireAndStorageIsBounded() async throws {
    let expired = ResponseCache(maxAge: 0)
    let _ = try await expired.load("post") { Data() }
    #expect(await expired.snapshot("post") == nil)
    let bounded = ResponseCache(capacity: 1)
    let _ = try await bounded.load("first") { Data() }
    let _ = try await bounded.load("second") { Data() }
    #expect(await bounded.snapshot("first") == nil)
    #expect(await bounded.snapshot("second") != nil)
  }
}
