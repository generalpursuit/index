import Foundation
import Testing

@testable import IndexCore

/// Runs only against the disposable PGlite fixture server, never a configured live API.
@Suite(
  .serialized, .enabled(if: ProcessInfo.processInfo.environment["INDEX_NATIVE_INTEGRATION"] == "1"))
struct LiveAPITests {
  @Test func nativeAccountLibraryAndPrivateForwardRoundTrip() async throws {
    let port = Int(ProcessInfo.processInfo.environment["INDEX_NATIVE_TEST_PORT"] ?? "3002") ?? 3002
    let base = URL(string: "http://localhost:\(port)")!
    var reset = URLRequest(url: base.appendingPathComponent("_test/reset"))
    reset.httpMethod = "POST"
    let (_, response) = try await URLSession.shared.data(for: reset)
    #expect((response as? HTTPURLResponse)?.statusCode == 200)
    let aliceStore = MemoryCredentials()
    let bobStore = MemoryCredentials()
    let alice = try APIClient(baseURL: base, credentials: aliceStore)
    let bob = try APIClient(baseURL: base, credentials: bobStore)
    let _ = try await alice.signIn(identifier: "alice@test.example", password: "test-password-123")
    let _ = try await bob.signIn(identifier: "bob", password: "test-password-123")
    #expect(try aliceStore.read()?.contains(".") == true)
    let restored = try APIClient(baseURL: base, credentials: aliceStore)
    let session = try await restored.restore()
    let me: Profile = try await alice.request("/me/profile")
    #expect(session?.user.id == me.id)
    let first: WeekFeed = try await alice.request(
      "/feed/week", query: ["weekStart": Week.monday(), "linkLimit": "2"])
    #expect(first.own.items.count == 2)
    #expect(first.own.nextCursor != nil)
    let more: Page<SavedLink> = try await alice.request(
      "/links", query: ["weekStart": Week.monday(), "cursor": first.own.nextCursor!])
    #expect(!Set(first.own.items.map(\.id)).intersection(more.items.map(\.id)).isEmpty == false)
    let group: LinkGroup = try await alice.request(
      "/groups", method: "POST", body: ["name": .string("Native test")])
    // Sharing uses the same native bearer transport through a read-only extension client.
    let shareClient = try APIClient(baseURL: base, credentials: ReadOnlyCredentials(aliceStore), externallyManagedSession: true)
    var shareDraft = ShareDraft(url: "https://pages.test/native-shared")
    shareDraft.groupID = group.id
    let shareBody = try shareDraft.body(accountID: me.id)
    let shared: ShareResult = try await shareClient.request("/links/share", method: "POST", body: shareBody)
    let retried: ShareResult = try await shareClient.request("/links/share", method: "POST", body: shareBody)
    #expect(shared.status == "saved" && retried.link.id == shared.link.id)
    var secondDraft = ShareDraft(url: shareDraft.url)
    let duplicate: ShareResult = try await shareClient.request("/links/share", method: "POST", body: secondDraft.body(accountID: me.id))
    #expect(duplicate.status == "existing" && duplicate.link.id == shared.link.id)
    let again: ShareResult = try await shareClient.request("/links/share", method: "POST", body: secondDraft.body(accountID: me.id, saveAgain: true))
    #expect(again.status == "saved" && again.link.id != shared.link.id)
    let link: SavedLink = try await alice.request(
      "/links", method: "POST",
      body: [
        "url": .string("https://example.com/native"), "title": .string("Native link"),
        "groupId": .string(group.id),
      ])
    let _: Success = try await alice.request("/links/\(link.id)/favorite", method: "PUT", body: [:])
    let favorited: SavedLink = try await alice.request("/links/\(link.id)")
    #expect(favorited.isFavorite)
    let comment: IndexCore.Comment = try await alice.request(
      "/links/\(link.id)/comments", method: "POST", body: ["body": .string("A native comment")])
    let comments: Page<IndexCore.Comment> = try await alice.request("/links/\(link.id)/comments")
    #expect(comments.items.first?.author?.id == me.id)
    let _: Success = try await alice.request("/comments/\(comment.id)", method: "DELETE")
    let iris: Profile = try await alice.request("/profiles/by-username/iris")
    let bobProfile: Profile = try await bob.request("/me/profile")
    let irisLinks: Page<SavedLink> = try await alice.request("/profiles/\(iris.id)/links")
    let conversation: Conversation = try await alice.request(
      "/conversations", method: "POST", body: ["recipientIds": .strings([bobProfile.id])])
    let original = try #require(irisLinks.items.first)
    let clientID = UUID().uuidString
    let sent: Message = try await alice.request(
      "/conversations/\(conversation.id)/messages", method: "POST",
      body: [
        "clientId": .string(clientID), "linkId": .string(original.id),
        "body": .string("A private find"),
      ])
    let retry: Message = try await alice.request(
      "/conversations/\(conversation.id)/messages", method: "POST",
      body: [
        "clientId": .string(clientID), "linkId": .string(original.id),
        "body": .string("A private find"),
      ])
    #expect(sent.id == retry.id)
    let received: Page<Message> = try await bob.request(
      "/conversations/\(conversation.id)/messages")
    let restricted = try #require(received.items.first)
    #expect(restricted.attachment == nil)
    #expect(restricted.hasAttachment)
    #expect(restricted.restrictedAuthor?.id == iris.id)
    let reply: Message = try await bob.request(
      "/conversations/\(conversation.id)/messages", method: "POST",
      body: ["clientId": .string(UUID().uuidString), "body": .string("I’ll request to follow.")])
    #expect(reply.senderId == bobProfile.id)
    let _: Success = try await alice.request(
      "/conversations/\(conversation.id)/read", method: "POST",
      body: ["messageId": .string(reply.id)])
    let activity: ActivityPage = try await alice.request("/me/activity", query: ["type": "request"])
    let pending = try #require(activity.items.first(where: { $0.requestStatus == "pending" }))
    let _: FollowState = try await alice.request(
      "/me/follow-requests/\(pending.actor.id)/accept", method: "POST", body: [:])
    let followers: PeoplePage = try await alice.request("/profiles/\(me.id)/followers")
    #expect(followers.items.contains(where: { $0.id == pending.actor.id }))
    let _: LinkGroup = try await alice.request(
      "/groups/\(group.id)", method: "PATCH", body: ["visibility": .string("private")])
    await #expect(throws: APIError.self) {
      let _: Message = try await alice.request(
        "/conversations/\(conversation.id)/messages", method: "POST",
        body: ["clientId": .string(UUID().uuidString), "linkId": .string(link.id)])
    }
    let _: Success = try await alice.request(
      "/groups/\(group.id)", method: "DELETE", body: ["deleteLinks": .bool(false)])
    let ungrouped: SavedLink = try await alice.request("/links/\(link.id)")
    #expect(ungrouped.groupId == nil)
    let _: Success = try await alice.request("/links/\(link.id)", method: "DELETE")
    try await alice.signOut()
    #expect(try aliceStore.read() == nil)
    #expect(try await alice.restore() == nil)
    try await bob.signOut()
  }
}
