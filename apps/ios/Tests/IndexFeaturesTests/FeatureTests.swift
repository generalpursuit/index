import Foundation
import XCTest
import IndexCore
@testable import IndexFeatures

private actor FeatureStub: FeatureAPI {
  struct Call: Sendable {
    let path: String
    let method: String
    let query: [String: String]
    let body: [String: JSONValue]?
  }
  private var replies: [String: [Result<Data, Error>]] = [:]
  private var calls: [Call] = []
  private var snapshots: [String: Data] = [:]
  private var paused: Set<String> = []
  private var continuations: [String: CheckedContinuation<Void, Never>] = [:]
  private var waiting: [String: [CheckedContinuation<Void, Never>]] = [:]
  func enqueue(_ path: String, _ json: String) { replies[path, default: []].append(.success(Data(json.utf8))) }
  func fail(_ path: String, _ error: Error) { replies[path, default: []].append(.failure(error)) }
  func pause(_ path: String) { paused.insert(path) }
  func started(_ path: String) async {
    if continuations[path] != nil { return }
    await withCheckedContinuation { waiting[path, default: []].append($0) }
  }
  func resume(_ path: String) { continuations.removeValue(forKey: path)?.resume() }
  func recorded() -> [Call] { calls }
  func snapshot(_ path: String, _ json: String) { snapshots[path] = Data(json.utf8) }
  func cached<T: Decodable & Sendable>(_ path: String, query: [String: String]) async -> T? {
    guard let data = snapshots[path] else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }
  func request<T: Decodable & Sendable>(_ path: String, method: String, query: [String: String], body: [String: JSONValue]?) async throws -> T {
    calls.append(Call(path: path, method: method, query: query, body: body))
    let key = path + (query["query"].map { "?" + $0 } ?? "")
    guard let result = replies[key]?.first else { throw APIError.invalidResponse }
    replies[key]?.removeFirst()
    if paused.remove(key) != nil {
      await withCheckedContinuation { continuation in
        continuations[key] = continuation
        waiting.removeValue(forKey: key)?.forEach { $0.resume() }
      }
    }
    return try JSONDecoder().decode(T.self, from: result.get())
  }
}

private func conversation(_ id: String) -> String {
  """
{"id":"\(id)","participants":[],"canSend":true,"unreadCount":0,"updatedAt":"2026-01-01"}
"""
}
private func message(_ id: String) -> String {
  """
{"id":"\(id)","conversationId":"chat","senderId":"me","clientId":"client","body":"hello","createdAt":"2026-01-01","hasAttachment":false}
"""
}
private func link(_ id: String) -> String {
  """
{"id":"\(id)","ownerId":"me","url":"https://example.com/\(id)","title":"\(id)","category":"article","isFavorite":false,"isStarred":false,"savedOn":"2026-01-01","createdAt":"2026-01-01","updatedAt":"2026-01-01"}
"""
}
private func activity(_ id: String) -> String {
  """
{"id":"\(id)","type":"follow","actor":{"id":"them","name":"Them","profileVisibility":"public"},"createdAt":"2026-01-01","readAt":"2026-01-01"}
"""
}
private func page(_ items: [String], next: String? = nil, unread: Bool = false) -> String {
  "{\"items\":[" + items.joined(separator: ",") + "],\"nextCursor\":" + (next.map { "\"\($0)\"" } ?? "null") + (unread ? ",\"unreadCount\":0" : "") + "}"
}
private func decode<T: Decodable>(_ json: String) throws -> T { try JSONDecoder().decode(T.self, from: Data(json.utf8)) }
private func payload(_ call: FeatureStub.Call) throws -> Data { try JSONEncoder().encode(call.body) }

@MainActor
final class MessagingTests: XCTestCase {
  func testUncertainSendRejectsPickerAndRouteAttachmentsAndRetriesIdenticalPayload() async throws {
    let api = FeatureStub()
    let drafts = MessageDrafts()
    let first: SavedLink = try decode(link("first"))
    let second: SavedLink = try decode(link("second"))
    drafts.edit(" hello ", in: "chat")
    try drafts.attach(first, to: "chat")
    await api.fail("/conversations/chat/messages", URLError(.networkConnectionLost))
    do { try await drafts.send(in: "chat", api: api); XCTFail("Expected uncertain response") } catch {}
    let pending = try XCTUnwrap(drafts.draft(for: "chat").pending)
    XCTAssertEqual(pending.body, "hello")
    XCTAssertEqual(pending.linkID, "first")
    // The picker and deep-link route both use this operation.
    XCTAssertThrowsError(try drafts.attach(second, to: "chat"))
    XCTAssertThrowsError(try drafts.attach(nil, to: "chat"))
    drafts.edit("changed", in: "chat")
    XCTAssertEqual(drafts.draft(for: "chat").body, " hello ")
    XCTAssertEqual(drafts.draft(for: "chat").pending, pending)
    await api.enqueue("/conversations/chat/messages", message("saved"))
    try await drafts.send(in: "chat", api: api)
    let calls = await api.recorded()
    let firstPayload = try JSONSerialization.jsonObject(with: payload(calls[0])) as? NSDictionary
    let retryPayload = try JSONSerialization.jsonObject(with: payload(calls[1])) as? NSDictionary
    XCTAssertEqual(firstPayload, retryPayload)
    XCTAssertTrue(drafts.draft(for: "chat").isEmpty)
  }

  func testValidationRecoveryAllowsCorrectionAndUsesNewIdentity() async throws {
    let api = FeatureStub()
    let drafts = MessageDrafts()
    drafts.edit("original", in: "chat")
    await api.fail("/conversations/chat/messages", APIError.server(422, "Invalid"))
    do { try await drafts.send(in: "chat", api: api); XCTFail("Expected rejection") } catch {}
    XCTAssertNil(drafts.draft(for: "chat").pending)
    drafts.edit("corrected", in: "chat")
    await api.enqueue("/conversations/chat/messages", message("sent"))
    try await drafts.send(in: "chat", api: api)
    let calls = await api.recorded()
    guard case .string(let oldID)? = calls[0].body?["clientId"], case .string(let newID)? = calls[1].body?["clientId"] else { return XCTFail("Missing IDs") }
    XCTAssertNotEqual(oldID, newID)
  }

  func testUncertainReplyRetriesTheSameRepliedMessage() async throws {
    let api = FeatureStub()
    let drafts = MessageDrafts()
    let original: Message = try decode(message("original"))
    let other: Message = try decode(message("other"))
    drafts.reply(to: original, in: "chat")
    drafts.edit("Agreed", in: "chat")
    await api.fail("/conversations/chat/messages", URLError(.timedOut))
    do { try await drafts.send(in: "chat", api: api); XCTFail("Expected uncertain response") } catch {}
    let pending = try XCTUnwrap(drafts.draft(for: "chat").pending)
    XCTAssertEqual(pending.replyToMessageID, "original")
    // Neither another reply nor cancelling can retarget a possibly committed send.
    drafts.reply(to: other, in: "chat")
    drafts.reply(to: nil, in: "chat")
    XCTAssertEqual(drafts.draft(for: "chat").replyTo?.id, "original")
    XCTAssertEqual(drafts.draft(for: "chat").pending, pending)
    await api.enqueue("/conversations/chat/messages", message("sent"))
    try await drafts.send(in: "chat", api: api)
    let calls = await api.recorded()
    let firstPayload = try JSONSerialization.jsonObject(with: payload(calls[0])) as? NSDictionary
    let retryPayload = try JSONSerialization.jsonObject(with: payload(calls[1])) as? NSDictionary
    XCTAssertEqual(firstPayload?["replyToMessageId"] as? String, "original")
    XCTAssertEqual(firstPayload, retryPayload)
    XCTAssertNil(drafts.draft(for: "chat").replyTo)
  }

  func testRejectedReplyCanStopQuotingBeforeTheNextAttempt() async throws {
    let api = FeatureStub()
    let drafts = MessageDrafts()
    let original: Message = try decode(message("original"))
    drafts.reply(to: original, in: "chat")
    drafts.edit("Agreed", in: "chat")
    await api.fail("/conversations/chat/messages", APIError.server(422, "Invalid"))
    do { try await drafts.send(in: "chat", api: api); XCTFail("Expected rejection") } catch {}
    XCTAssertEqual(drafts.draft(for: "chat").replyTo?.excerpt, "hello")
    drafts.reply(to: nil, in: "chat")
    await api.enqueue("/conversations/chat/messages", message("sent"))
    try await drafts.send(in: "chat", api: api)
    let calls = await api.recorded()
    XCTAssertNotNil(calls[0].body?["replyToMessageId"])
    XCTAssertNil(calls[1].body?["replyToMessageId"])
  }

  func testAccountClearRejectsLateSendWithoutErasingNewAccountDraft() async throws {
    let api = FeatureStub()
    let drafts = MessageDrafts()
    drafts.edit("old account", in: "chat")
    await api.enqueue("/conversations/chat/messages", message("sent"))
    await api.pause("/conversations/chat/messages")
    let send = Task { try await drafts.send(in: "chat", api: api) }
    await api.started("/conversations/chat/messages")
    drafts.clear()
    drafts.edit("new account", in: "chat")
    await api.resume("/conversations/chat/messages")
    do { try await send.value; XCTFail("Old send must be invalidated") } catch is CancellationError {} catch { XCTFail("Unexpected \(error)") }
    XCTAssertEqual(drafts.draft(for: "chat").body, "new account")
    XCTAssertFalse(drafts.isSending("chat"))
  }

  func testConversationPollingReplaysLoadedPagesAndDeduplicatesBoundaries() async throws {
    let api = FeatureStub()
    let model = ConversationListModel()
    await api.enqueue("/conversations", page([conversation("a")], next: "cursor1"))
    try await model.load(api: api, query: "")
    await api.enqueue("/conversations", page([conversation("a"), conversation("b")], next: "cursor2"))
    try await model.load(api: api, query: "", more: true)
    XCTAssertEqual(model.conversations.map(\.id), ["a", "b"])
    await api.enqueue("/conversations", page([conversation("new"), conversation("a")], next: "fresh1"))
    await api.enqueue("/conversations", page([conversation("a"), conversation("b")], next: "fresh2"))
    try await model.load(api: api, query: "")
    XCTAssertEqual(model.conversations.map(\.id), ["new", "a", "b"])
    XCTAssertEqual(model.cursor, "fresh2")
    let calls = await api.recorded()
    XCTAssertEqual(calls.last?.query["cursor"], "fresh1")
  }

  func testOldSearchCompletionCannotReplaceNewQueryEvenWhenTransportIgnoresCancellation() async throws {
    let api = FeatureStub()
    let model = ConversationListModel()
    await api.enqueue("/conversations?old", page([conversation("old")]))
    await api.pause("/conversations?old")
    let old = Task { try await model.load(api: api, query: "old") }
    await api.started("/conversations?old")
    await api.enqueue("/conversations?new", page([conversation("new")]))
    try await model.load(api: api, query: "new")
    await api.resume("/conversations?old")
    try await old.value
    XCTAssertEqual(model.conversations.map(\.id), ["new"])
    XCTAssertFalse(model.loading)
  }

  func testRefreshSupersedesPaginationAndDuplicateMoreRequestsAreIgnored() async throws {
    let api = FeatureStub()
    let model = ConversationListModel()
    await api.enqueue("/conversations", page([conversation("a")], next: "next"))
    try await model.load(api: api, query: "")
    await api.enqueue("/conversations", page([conversation("stale")]))
    await api.pause("/conversations")
    let more = Task { try await model.load(api: api, query: "", more: true) }
    await api.started("/conversations")
    try await model.load(api: api, query: "", more: true)
    await api.enqueue("/conversations", page([conversation("fresh")]))
    try await model.load(api: api, query: "")
    await api.resume("/conversations")
    try await more.value
    XCTAssertEqual(model.conversations.map(\.id), ["fresh"])
    let calls = await api.recorded()
    XCTAssertEqual(calls.count, 3)
  }

  func testConversationAccessRevocationClearsParticipantsMessagesAndCursor() async throws {
    let api = FeatureStub()
    let model = ConversationModel()
    await api.enqueue("/conversations/chat", conversation("chat"))
    await api.enqueue("/conversations/chat/messages", page([message("m")], next: "next"))
    await api.enqueue("/conversations/chat/read", "{\"success\":true}")
    try await model.load(api: api, id: "chat")
    XCTAssertEqual(model.messages.count, 1)
    await api.fail("/conversations/chat", URLError(.notConnectedToInternet))
    do { try await model.load(api: api, id: "chat") } catch {}
    XCTAssertEqual(model.messages.count, 1)
    XCTAssertNotNil(model.conversation)
    await api.fail("/conversations/chat", APIError.server(403, "Forbidden"))
    do { try await model.load(api: api, id: "chat") } catch {}
    XCTAssertTrue(model.messages.isEmpty)
    XCTAssertNil(model.conversation)
    XCTAssertNil(model.cursor)
  }
}

@MainActor
final class ProfileActivityTests: XCTestCase {
  func testProfileLinksSurviveOfflineButClearAfterMissingOrRestrictedAccess() async throws {
    for error in [APIError.server(404, "Missing"), .emailNotVerified] {
      let api = FeatureStub()
      let model = ProfileWeekModel()
      await api.snapshot("/profiles/me/links", page([link("secret")], next: "next"))
      await api.fail("/profiles/me/links", URLError(.notConnectedToInternet))
      do { try await model.load(api: api, userID: "me", week: "2026-01-01", filter: "all") } catch {}
      XCTAssertEqual(model.links.count, 1)
      await api.fail("/profiles/me/links", error)
      do { try await model.load(api: api, userID: "me", week: "2026-01-01", filter: "all") } catch {}
      XCTAssertTrue(model.links.isEmpty)
      XCTAssertNil(model.cursor)
    }
  }

  func testProfileFilterChangeDropsOldPaginationCompletion() async throws {
    let api = FeatureStub()
    let model = ProfileWeekModel()
    await api.enqueue("/groups/old/links", page([link("old")]))
    await api.pause("/groups/old/links")
    let old = Task { try await model.load(api: api, userID: "me", week: "2026-01-01", filter: "old") }
    await api.started("/groups/old/links")
    await api.enqueue("/groups/new/links", page([link("new")]))
    try await model.load(api: api, userID: "me", week: "2026-01-01", filter: "new")
    await api.resume("/groups/old/links")
    try await old.value
    XCTAssertEqual(model.links.map(\.id), ["new"])
  }

  func testActivityRefreshRetainsLoadedExtentAndFilterStartsFresh() async throws {
    let api = FeatureStub()
    let model = ActivityModel()
    await api.enqueue("/me/activity", page([activity("a")], next: "next", unread: true))
    try await model.load(api: api, filter: "all")
    await api.enqueue("/me/activity", page([activity("b")], unread: true))
    try await model.load(api: api, filter: "all", more: true)
    await api.enqueue("/me/activity", page([activity("a")], next: "fresh", unread: true))
    await api.enqueue("/me/activity", page([activity("b")], unread: true))
    try await model.load(api: api, filter: "all")
    XCTAssertEqual(model.items.map(\.id), ["a", "b"])
    await api.enqueue("/me/activity", page([activity("filtered")], unread: true))
    try await model.load(api: api, filter: "comment")
    XCTAssertEqual(model.items.map(\.id), ["filtered"])
  }
}

@MainActor
final class SessionNavigationTests: XCTestCase {
  func testPendingLaunchRouteBindsToAccountButDoesNotCrossAccounts() async {
    let navigation = AppNavigation()
    let url = URL(string: "https://example.com/messages/chat")!
    navigation.pendingRouteURL = url
    navigation.clearAccount(preserveUnownedRoute: true)
    XCTAssertEqual(navigation.pendingRouteURL, url)
    navigation.acceptAccount("one")
    XCTAssertEqual(navigation.pendingRouteAccountID, "one")
    navigation.path = [.conversation("chat")]
    navigation.sheet = .settings
    navigation.tab = .messages
    navigation.acceptAccount("one")
    XCTAssertEqual(navigation.pendingRouteURL, url)
    XCTAssertTrue(navigation.path.isEmpty)
    XCTAssertNil(navigation.sheet)
    XCTAssertEqual(navigation.tab, .feed)
    navigation.acceptAccount("two")
    XCTAssertNil(navigation.pendingRouteURL)
    XCTAssertNil(navigation.pendingRouteAccountID)
  }

  func testSameAccountVerificationAdvancesRevisionAndLateProfileCannotUndoLogout() async throws {
    let session = AccountSession()
    let restricted: AuthUser = try decode("""
{"id":"me","name":"Me","email":"me@example.com","emailVerified":false}
""")
    let verified: AuthUser = try decode("""
{"id":"me","name":"Me","email":"me@example.com","emailVerified":true}
""")
    let profile: Profile = try decode("""
{"id":"me","name":"Me","profileVisibility":"public","canViewContent":true,"followedBy":{"users":[],"total":0}}
""")
    session.begin(restricted)
    XCTAssertNotNil(session.verificationUser)
    XCTAssertNil(session.profile)
    let version = session.begin(verified)
    try session.verified(profile, generation: version)
    XCTAssertEqual(session.verifiedRevision, 1)
    XCTAssertNil(session.verificationUser)
    session.clear()
    XCTAssertThrowsError(try session.verified(profile, generation: version))
    XCTAssertNil(session.profile)
  }
}

private func feed(_ ids: [String], next: String? = nil) -> String {
  "{\"weekStart\":\"2026-01-01\",\"own\":" + page(ids.map(link), next: next) + ",\"people\":[]}"
}

@MainActor
final class FeedTests: XCTestCase {
  func testFeedRefreshReplaysLoadedOwnLinksAndClearsRevokedData() async throws {
    let api = FeatureStub()
    let model = FeedWeekModel()
    await api.enqueue("/feed/week", feed(["a"], next: "one"))
    try await model.load(api: api, week: "2026-01-01")
    await api.enqueue("/links", page([link("a"), link("b")], next: "two"))
    try await model.moreOwn(api: api, week: "2026-01-01")
    XCTAssertEqual(model.feed?.own.items.map(\.id), ["a", "b"])
    await api.enqueue("/feed/week", feed(["new", "a"], next: "fresh"))
    await api.enqueue("/links", page([link("b")], next: "last"))
    try await model.load(api: api, week: "2026-01-01")
    XCTAssertEqual(model.feed?.own.items.map(\.id), ["new", "a", "b"])
    XCTAssertEqual(model.feed?.own.nextCursor, "last")
    await api.fail("/feed/week", URLError(.notConnectedToInternet))
    do { try await model.load(api: api, week: "2026-01-01") } catch {}
    XCTAssertEqual(model.feed?.own.items.count, 3)
    await api.fail("/feed/week", APIError.server(403, "Forbidden"))
    do { try await model.load(api: api, week: "2026-01-01") } catch {}
    XCTAssertNil(model.feed)
  }

  func testFeedRefreshRejectsOverlappingPaginationCompletion() async throws {
    let api = FeatureStub()
    let model = FeedWeekModel()
    await api.enqueue("/feed/week", feed(["a"], next: "one"))
    try await model.load(api: api, week: "2026-01-01")
    await api.enqueue("/links", page([link("stale")]))
    await api.pause("/links")
    let more = Task { try await model.moreOwn(api: api, week: "2026-01-01") }
    await api.started("/links")
    await api.enqueue("/feed/week", feed(["fresh"]))
    try await model.load(api: api, week: "2026-01-01")
    await api.resume("/links")
    try await more.value
    XCTAssertEqual(model.feed?.own.items.map(\.id), ["fresh"])
  }
}

@MainActor
final class ReceiptCancellationTests: XCTestCase {
  func testLoadedUnreadActivitiesRespectReceiptBatchLimit() async throws {
    let api = FeatureStub()
    let model = ActivityModel()
    let ranges = [0..<30, 30..<60, 60..<90, 90..<105]
    for (index, range) in ranges.enumerated() {
      let unread = range.map { activity("\($0)").replacingOccurrences(of: "\"readAt\":\"2026-01-01\"", with: "\"readAt\":null") }
      await api.enqueue("/me/activity", page(unread, next: index == 3 ? nil : "next-\(index)", unread: true))
      await api.enqueue("/me/activity/read", "{\"success\":true}")
      if index == 3 { await api.enqueue("/me/activity/read", "{\"success\":true}") }
      try await model.load(api: api, filter: "all", more: index > 0)
    }
    let receipts = await api.recorded().filter { $0.path == "/me/activity/read" }
    let sizes = receipts.compactMap { call -> Int? in
      guard case .strings(let ids)? = call.body?["ids"] else { return nil }
      return ids.count
    }
    XCTAssertEqual(sizes, [30, 60, 90, 100, 5])
  }

  func testCanceledRefreshPreservesRowsWithoutShowingAnError() async throws {
    let api = FeatureStub()
    let model = ConversationListModel()
    await api.enqueue("/conversations", page([conversation("existing")]))
    try await model.load(api: api, query: "")
    await api.enqueue("/conversations", page([conversation("canceled")]))
    await api.pause("/conversations")
    let refresh = Task { try await model.load(api: api, query: "") }
    await api.started("/conversations")
    refresh.cancel()
    await api.resume("/conversations")
    try await refresh.value
    XCTAssertEqual(model.conversations.map(\.id), ["existing"])
    XCTAssertNil(model.error)
    XCTAssertFalse(model.loading)
  }
}

@MainActor
final class AtomicRefreshTests: XCTestCase {
  func testFailedSecondRefreshPageKeepsPreviouslyDisplayedExtentAndCursor() async throws {
    let api = FeatureStub()
    let model = ConversationListModel()
    await api.enqueue("/conversations", page([conversation("a")], next: "one"))
    try await model.load(api: api, query: "")
    await api.enqueue("/conversations", page([conversation("b")], next: "two"))
    try await model.load(api: api, query: "", more: true)
    await api.enqueue("/conversations", page([conversation("new")], next: "new-page"))
    await api.fail("/conversations", URLError(.networkConnectionLost))
    do { try await model.load(api: api, query: ""); XCTFail("Expected a failed second page") } catch {}
    XCTAssertEqual(model.conversations.map(\.id), ["a", "b"])
    XCTAssertEqual(model.cursor, "two")
    XCTAssertNotNil(model.error)
  }
}

@MainActor
final class RetryFeedbackTests: XCTestCase {
  func testProfileWeekRetryClearsPreviousFailure() async throws {
    let api = FeatureStub()
    let model = ProfileModel()
    await api.enqueue("/profiles/me", """
      {"id":"me","name":"Me","profileVisibility":"public","canViewContent":true,"followedBy":{"users":[],"total":0}}
      """)
    await api.enqueue("/groups", page([]))
    let weeks = "{\"items\":[{\"weekStart\":\"2026-01-01\",\"count\":1}],\"nextBefore\":null}"
    await api.enqueue("/profiles/me/weeks", weeks)
    try await model.load(api: api, userID: "me", filter: "all")
    await api.fail("/profiles/me/weeks", URLError(.notConnectedToInternet))
    do { try await model.loadWeeks(api: api, userID: "me", filter: "all") } catch {}
    XCTAssertNotNil(model.error)
    XCTAssertEqual(model.weeks.count, 1)
    await api.enqueue("/profiles/me/weeks", weeks)
    try await model.loadWeeks(api: api, userID: "me", filter: "all")
    XCTAssertNil(model.error)
  }

  func testFeedPaginationRetryClearsPreviousFailure() async throws {
    let api = FeatureStub()
    let model = FeedWeekModel()
    await api.enqueue("/feed/week", feed(["a"], next: "one"))
    try await model.load(api: api, week: "2026-01-01")
    await api.fail("/links", URLError(.notConnectedToInternet))
    do { try await model.moreOwn(api: api, week: "2026-01-01") } catch {}
    XCTAssertNotNil(model.error)
    XCTAssertEqual(model.feed?.own.items.map(\.id), ["a"])
    await api.enqueue("/links", page([link("b")]))
    try await model.moreOwn(api: api, week: "2026-01-01")
    XCTAssertNil(model.error)
    XCTAssertEqual(model.feed?.own.items.map(\.id), ["a", "b"])
  }
}

@MainActor
final class ConcurrentFeedbackTests: XCTestCase {
  func testSuccessfulWeeksRequestDoesNotHideConcurrentProfileFailure() async throws {
    let api = FeatureStub()
    let model = ProfileModel()
    await api.enqueue("/profiles/me", """
      {"id":"me","name":"Me","profileVisibility":"public","canViewContent":true,"followedBy":{"users":[],"total":0}}
      """)
    await api.enqueue("/groups", page([]))
    let weeks = "{\"items\":[{\"weekStart\":\"2026-01-01\",\"count\":1}],\"nextBefore\":null}"
    await api.enqueue("/profiles/me/weeks", weeks)
    try await model.load(api: api, userID: "me", filter: "all")
    await api.fail("/profiles/me", APIError.server(500, "Profile failed"))
    await api.pause("/profiles/me")
    let profile = Task { try await model.load(api: api, userID: "me", filter: "all") }
    await api.started("/profiles/me")
    await api.enqueue("/profiles/me/weeks", weeks)
    await api.pause("/profiles/me/weeks")
    let reloadWeeks = Task { try await model.loadWeeks(api: api, userID: "me", filter: "all") }
    await api.started("/profiles/me/weeks")
    await api.resume("/profiles/me")
    do { try await profile.value; XCTFail("Expected profile failure") } catch {}
    await api.resume("/profiles/me/weeks")
    try await reloadWeeks.value
    XCTAssertEqual(model.error, "Profile failed")
  }
}

final class MessageTimelineTests: XCTestCase {
  // A fixed zone and locale, so the expectations hold on any machine.
  private let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Berlin")!
    return calendar
  }()
  private let locale = Locale(identifier: "en_GB")
  private func at(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
    calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
  }
  private func sent(_ id: String, by sender: String, at date: Date) throws -> Message {
    let createdAt = date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    return try decode(
      #"{"id":"\#(id)","conversationId":"chat","senderId":"\#(sender)","clientId":"\#(id)","body":"hello","createdAt":"\#(createdAt)","hasAttachment":false}"#)
  }

  func testGroupsSendersIntoRunsAndStampsAfterAnHourPause() throws {
    let rows = MessageTimeline.rows([
      try sent("1", by: "bob", at: at(2026, 10, 13, 9, 0)),
      try sent("2", by: "bob", at: at(2026, 10, 13, 9, 5)),
      try sent("3", by: "alice", at: at(2026, 10, 13, 9, 6)),
      try sent("4", by: "bob", at: at(2026, 10, 13, 10, 6)),
      try sent("5", by: "bob", at: at(2026, 10, 13, 11, 5)),
    ])
    XCTAssertEqual(rows.map(\.stamp), [at(2026, 10, 13, 9, 0), nil, nil, at(2026, 10, 13, 10, 6), nil])
    XCTAssertEqual(rows.map(\.startsRun), [true, false, true, true, false])
    // A run also ends where a new section starts, so its last bubble keeps the tail.
    XCTAssertEqual(rows.map(\.endsRun), [false, true, true, false, true])
    XCTAssertTrue(MessageTimeline.rows([]).isEmpty)
  }

  func testStampsReadLikeMessagesInTheViewersCalendar() {
    let now = at(2026, 10, 13, 18, 0)
    func label(_ date: Date, now: Date = now) -> String {
      MessageTimeline.stamp(date, now: now, calendar: calendar, locale: locale).text
    }
    XCTAssertEqual(label(at(2026, 10, 13, 11, 15)), "Today 11:15")
    XCTAssertEqual(label(at(2026, 10, 12, 9, 2)), "Yesterday 09:02")
    XCTAssertEqual(label(at(2026, 10, 8, 23, 40)), "Thursday 23:40")
    XCTAssertEqual(label(at(2026, 10, 4, 14, 19)), "Sun 4 Oct at 14:19")
    XCTAssertEqual(label(at(2025, 12, 30, 8, 0)), "30 Dec 2025 at 08:00")
    // A clock slightly ahead of this device still reads as today.
    XCTAssertEqual(label(at(2026, 10, 13, 18, 1)), "Today 18:01")
    // The day daylight saving starts lasts 23 hours but is still a whole day.
    XCTAssertEqual(label(at(2026, 3, 29, 12, 0), now: at(2026, 3, 30, 9, 0)), "Yesterday 12:00")
  }
}
