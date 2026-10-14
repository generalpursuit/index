import Foundation
import Testing
@testable import IndexCore

struct PersistentCacheTests {
  private func folder() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }
  @Test func restoresOnlyAcceptedAccountAndErasesTransitions() async throws {
    let directory = folder()
    defer { try? FileManager.default.removeItem(at: directory) }
    let first = ResponseCache(directory: directory)
    await first.accept(scope: "https://one.example", account: "alice")
    _ = try await first.load("/links/a") { Data("private".utf8) }
    let relaunched = ResponseCache(directory: directory)
    #expect(relaunched.snapshot("/links/a") == nil)
    await relaunched.accept(scope: "https://one.example", account: "alice")
    #expect(relaunched.snapshot("/links/a") == Data("private".utf8))
    await relaunched.accept(scope: "https://one.example", account: "bob")
    #expect(relaunched.snapshot("/links/a") == nil)
    await relaunched.accept(scope: "https://one.example", account: "alice")
    #expect(relaunched.snapshot("/links/a") == nil)
    _ = try await relaunched.load("/links/b") { Data("second".utf8) }
    await relaunched.clear()
    let afterLogout = ResponseCache(directory: directory)
    await afterLogout.accept(scope: "https://one.example", account: "alice")
    #expect(afterLogout.snapshot("/links/b") == nil)
  }
  @Test func serverChangeErasesPreviouslyAcceptedServers() async throws {
    let directory = folder()
    defer { try? FileManager.default.removeItem(at: directory) }
    let first = ResponseCache(directory: directory)
    await first.accept(scope: "https://one.example", account: "alice")
    _ = try await first.load("/links/a") { Data("private".utf8) }
    let switched = ResponseCache(directory: directory)
    await switched.accept(scope: "https://two.example", account: "alice")
    #expect(switched.snapshot("/links/a") == nil)
    let originalServer = ResponseCache(directory: directory)
    await originalServer.accept(scope: "https://one.example", account: "alice")
    #expect(originalServer.snapshot("/links/a") == nil)
  }
  @Test func rejectsWrongScopeFormatAndExpiredDiskEntries() async throws {
    for changed in ["format", "stored", "scope", "account"] {
      let directory = folder()
      defer { try? FileManager.default.removeItem(at: directory) }
      let cache = ResponseCache(directory: directory)
      await cache.accept(scope: "https://one.example", account: "alice")
      _ = try await cache.load("/links/a") { Data("private".utf8) }
      let files = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)!
      let file = files.compactMap { $0 as? URL }.first { $0.pathExtension == "json" && (try? Data(contentsOf: $0)) != nil }!
      var envelope = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
      switch changed {
      case "format": envelope[changed] = 99
      case "stored": envelope[changed] = Date().addingTimeInterval(-8 * 24 * 60 * 60).timeIntervalSinceReferenceDate
      default: envelope[changed] = "wrong"
      }
      try JSONSerialization.data(withJSONObject: envelope).write(to: file)
      let relaunched = ResponseCache(directory: directory)
      await relaunched.accept(scope: "https://one.example", account: "alice")
      #expect(relaunched.snapshot("/links/a") == nil)
      #expect(!FileManager.default.fileExists(atPath: file.path))
    }
  }
  @Test func targetedInvalidationKeepsUnrelatedSnapshotsAndEvictsDisk() async throws {
    let directory = folder()
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = ResponseCache(directory: directory)
    await cache.accept(scope: "https://one.example", account: "alice")
    _ = try await cache.load("/links/a?limit=30") { Data("post".utf8) }
    _ = try await cache.load("/conversations/a") { Data("chat".utf8) }
    await cache.invalidate(["/links"])
    #expect(cache.snapshot("/links/a?limit=30") == nil)
    #expect(cache.snapshot("/conversations/a") == Data("chat".utf8))
    let relaunched = ResponseCache(directory: directory)
    await relaunched.accept(scope: "https://one.example", account: "alice")
    #expect(relaunched.snapshot("/links/a?limit=30") == nil)
    #expect(relaunched.snapshot("/conversations/a") == Data("chat".utf8))
  }
  @Test func searchesAndDeviceStateNeverPersist() async throws {
    let directory = folder()
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = ResponseCache(directory: directory)
    await cache.accept(scope: "https://one.example", account: "alice")
    for key in ["/conversations?query=secret", "/me/notifications/preferences", "/me/pulse"] {
      _ = try await cache.load(key) { Data("ephemeral".utf8) }
      #expect(cache.snapshot(key) != nil)
      let relaunched = ResponseCache(directory: directory)
      await relaunched.accept(scope: "https://one.example", account: "alice")
      #expect(relaunched.snapshot(key) == nil)
    }
  }
}
