import Foundation
import Testing
@testable import IndexCore

struct SharingTests {
  @Test func scopesMatchMacHostFixtures() throws {
    struct Fixture: Decodable { let input: String; let output: String? }
    let url = Bundle.module.url(forResource: "api-scopes", withExtension: "json", subdirectory: "Fixtures")!
    for fixture in try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url)) {
      #expect((try? APIScope.normalize(fixture.input)) == fixture.output)
    }
  }
  @Test func retriesAreBoundToAccountAndPayload() throws {
    var draft = ShareDraft(url: "https://example.test/read")
    let encode = { (body: [String: JSONValue]) throws in
      try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as! [String: Any]
    }
    let first = try encode(draft.body(accountID: "alice"))
    #expect(first["requestId"] as? String == (try encode(draft.body(accountID: "alice")))["requestId"] as? String)
    let again = try encode(draft.body(accountID: "alice", saveAgain: true))
    #expect(first["requestId"] as? String != again["requestId"] as? String)
    #expect(again["requestId"] as? String == (try encode(draft.body(accountID: "alice", saveAgain: true)))["requestId"] as? String)
    draft.groupID = UUID().uuidString
    #expect(again["requestId"] as? String != (try encode(draft.body(accountID: "alice", saveAgain: true)))["requestId"] as? String)
    #expect(first["requestId"] as? String != (try encode(draft.body(accountID: "bob")))["requestId"] as? String)
  }
  @Test func validatesSingleSharedWebURL() {
    #expect(ShareDraft.validURL(" https://example.test/read \n") != nil)
    for invalid in ["", "no URL", "file:///tmp/private", "https://user:pass@example.test", "https://one.test https://two.test"] {
      #expect(ShareDraft.validURL(invalid) == nil)
    }
  }
  @Test func destinationReconcilesRenamePrivacyAndDeletionWithoutChangingTheChoice() throws {
    let original = try JSONDecoder().decode(LinkGroup.self, from: Data(#"{"id":"group-one","name":"Old name","ownerId":"alice","kind":"custom","visibility":"private"}"#.utf8))
    var changed = original; changed.name = "New name"; changed.visibility = .public
    let refreshed = ShareDraft.destination(original, in: [changed], complete: true)
    #expect(refreshed.group?.name == "New name")
    #expect(refreshed.group?.visibility == .public)
    #expect(!refreshed.unavailable)
    let partial = ShareDraft.destination(original, in: [], complete: false)
    #expect(!partial.unavailable); #expect(partial.group?.id == original.id)
    let missing = ShareDraft.destination(original, in: [], complete: true)
    #expect(missing.unavailable); #expect(missing.group?.id == original.id)
  }
  @Test func extensionCannotWriteCredential() throws {
    let memory = MemoryCredentials("alice.signed")
    let reader = ReadOnlyCredentials(memory)
    try reader.write("bob.signed"); #expect(try reader.read() == "alice.signed")
    try reader.write(nil); #expect(try reader.read() == "alice.signed")
  }
}
