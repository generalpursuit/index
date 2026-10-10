import Foundation
import Testing
@testable import IndexCore

// Extending the existing serialized opt-in suite avoids sharing a resetting fixture concurrently.
extension LiveAPITests {
  @Test func createdGroupCanBeSelectedAndConflictsKeepDraft() async throws {
    let port = Int(ProcessInfo.processInfo.environment["INDEX_NATIVE_TEST_PORT"] ?? "3002") ?? 3002
    let base = URL(string: "http://localhost:\(port)")!
    var reset = URLRequest(url: base.appendingPathComponent("_test/reset"))
    reset.httpMethod = "POST"
    let (_, response) = try await URLSession.shared.data(for: reset)
    #expect((response as? HTTPURLResponse)?.statusCode == 200)
    let api = try APIClient(baseURL: base, credentials: MemoryCredentials())
    let _ = try await api.signIn(identifier: "alice", password: "test-password-123")
    var draft = GroupDraft()
    draft.name = " Native   selection "
    draft.locked = true
    let created: LinkGroup = try await api.request("/groups", method: "POST", body: draft.body)
    #expect(created.name == "Native selection")
    #expect(created.slug == "native-selection")
    #expect(created.visibility == .private)
    let link: SavedLink = try await api.request("/links", method: "POST", body: [
      "url": .string("https://example.com/group-selection"), "title": .string("Select returned group"),
      "groupId": .string(created.id)
    ])
    #expect(link.groupId == created.id)
    draft.name = "NATIVE SELECTION"
    do {
      let _: LinkGroup = try await api.request("/groups", method: "POST", body: draft.body)
      Issue.record("Duplicate name should fail")
    } catch APIError.server(let status, _) { #expect(status == 409) }
    #expect(draft.name == "NATIVE SELECTION")
    #expect(draft.locked)
    let _: LinkGroup = try await api.request("/groups/\(created.id)", method: "PATCH", body: ["name": .string("Native renamed")])
    draft.name = "Native selection!"
    do {
      let _: LinkGroup = try await api.request("/groups", method: "POST", body: draft.body)
      Issue.record("Historical slug should remain reserved")
    } catch APIError.server(let status, _) { #expect(status == 409) }
    try await api.signOut()
  }
}
