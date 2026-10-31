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
  private nonisolated let snapshots = SnapshotStub()
  private var paused: Set<String> = []
  private var continuations: [String: CheckedContinuation<Void, Never>] = [:]
  private var waiting: [String: [CheckedContinuation<Void, Never>]] = [:]
  private var responders: [String: @Sendable ([String: JSONValue]?) -> String] = [:]
  func enqueue(_ path: String, _ json: String) { replies[path, default: []].append(.success(Data(json.utf8))) }
  /// Answers requests to `path` that have no queued reply from their body, as a server
  /// echoing what it stored would.
  func respond(_ path: String, _ reply: @escaping @Sendable ([String: JSONValue]?) -> String) { responders[path] = reply }
  func fail(_ path: String, _ error: Error) { replies[path, default: []].append(.failure(error)) }
  func pause(_ path: String) { paused.insert(path) }
  func started(_ path: String) async {
    if continuations[path] != nil { return }
    await withCheckedContinuation { waiting[path, default: []].append($0) }
  }
  func resume(_ path: String) { continuations.removeValue(forKey: path)?.resume() }
  func recorded() -> [Call] { calls }
  func snapshot(_ path: String, _ json: String) { snapshots.write(path, data: Data(json.utf8)) }
  nonisolated func snapshotDate(_ path: String, query: [String: String]) -> Date? {
    snapshots.read(path) == nil ? nil : .now
  }
  nonisolated func snapshot<T: Decodable & Sendable>(_ path: String, query: [String: String]) -> T? {
    guard let data = snapshots.read(path) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }
  func cached<T: Decodable & Sendable>(_ path: String, query: [String: String]) async -> T? {
    guard let data = snapshots.read(path) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }
  func request<T: Decodable & Sendable>(_ path: String, method: String, query: [String: String], body: [String: JSONValue]?) async throws -> T {
    calls.append(Call(path: path, method: method, query: query, body: body))
    let key = path + (query["query"].map { "?" + $0 } ?? "")
    if replies[key]?.first == nil, let responder = responders[key] {
      return try JSONDecoder().decode(T.self, from: Data(responder(body).utf8))
    }
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
  private(set) var uploads: [(path: String, name: String, fields: [String: String])] = []
  func upload<T: Decodable & Sendable>(_ path: String, file: UploadFile, fields: [String: String]) async throws -> T {
    uploads.append((path, file.name, fields))
    return try await request(path, method: "POST", query: [:], body: nil)
  }
  private(set) var downloads: [String] = []
  func download(_ path: String) async throws -> Data {
    downloads.append(path)
    return Data()
  }
}

private func conversation(_ id: String) -> String {
  """
{"id":"\(id)","participants":[],"canSend":true,"unreadCount":0,"updatedAt":"2026-01-01"}
"""
}
private func message(_ id: String) -> String {
  """
{"id":"\(id)","conversationId":"chat","senderId":"me","clientId":"client","body":"hello","createdAt":"2026-01-01","hasAttachment":false,"files":[]}
"""
}
private func uploadedFile(_ id: String, name: String? = nil) -> String {
  #"{"id":"\#(id)","name":"\#(name ?? id + ".pdf")","type":"application/octet-stream","size":1,"width":null,"height":null}"#
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

  func testTimeoutAndThrottleKeepImmutablePendingPayload() async throws {
    for status in [408, 429] {
      let api = FeatureStub()
      let drafts = MessageDrafts()
      drafts.edit("original", in: "chat")
      await api.fail("/conversations/chat/messages", APIError.server(status, "Retry later"))
      do { try await drafts.send(in: "chat", api: api); XCTFail("Expected failure") } catch {}
      let pending = try XCTUnwrap(drafts.draft(for: "chat").pending)
      drafts.edit("changed", in: "chat")
      XCTAssertEqual(drafts.draft(for: "chat").pending, pending)
      XCTAssertEqual(drafts.draft(for: "chat").body, "original")
    }
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

  func testCachedEmptyListStaysVisibleDuringRefresh() async throws {
    let api = FeatureStub()
    await api.snapshot("/conversations", page([]))
    let model = ConversationListModel(api: api)
    XCTAssertTrue(model.hasLoaded)
    await api.enqueue("/conversations", page([]))
    await api.pause("/conversations")
    let refresh = Task { try await model.load(api: api, query: "") }
    await api.started("/conversations")
    XCTAssertTrue(model.hasLoaded)
    XCTAssertFalse(model.loading)
    await api.resume("/conversations")
    try await refresh.value
    XCTAssertTrue(model.hasLoaded)
    XCTAssertFalse(model.loading)
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

  func testFilesUploadFirstAndJoinTheSendInOrder() async throws {
    let api = FeatureStub(), drafts = MessageDrafts()
    for id in ["a", "b"] {
      await api.enqueue("/conversations/c/files", #"{"id":"\#(id)","name":"\#(id)","type":"image/jpeg","size":1,"width":4,"height":3}"#)
    }
    drafts.edit("Look", in: "c")
    try drafts.add(
      [DraftFile(name: "a.jpg", type: "image/jpeg", data: Data([1]), width: 4, height: 3),
       DraftFile(name: "b.pdf", type: "application/pdf", data: Data([2]))], to: "c", api: api)
    XCTAssertFalse(drafts.draft(for: "c").isReady)
    await drafts.idle()
    let uploaded = drafts.draft(for: "c").files.compactMap(\.uploaded?.id)
    XCTAssertEqual(uploaded.count, 2)
    let uploads = await api.uploads
    XCTAssertEqual(uploads.first { $0.name == "a.jpg" }?.fields, ["width": "4", "height": "3"])
    XCTAssertEqual(uploads.first { $0.name == "b.pdf" }?.fields, [:])
    await api.enqueue("/conversations/c/messages", message("m"))
    var sent: PendingMessage?
    try await drafts.send(in: "c", api: api, started: { pending, _ in sent = pending })
    XCTAssertEqual(sent?.files.map(\.id), uploaded)
    guard case .strings(let ids)? = sent?.payload["fileIds"] else { return XCTFail("no fileIds") }
    XCTAssertEqual(ids, uploaded)
  }

  func testAFailedUploadBlocksSendingUntilRemoved() async throws {
    let api = FeatureStub(), drafts = MessageDrafts()
    await api.fail("/conversations/c/files", APIError.server(500, "Down"))
    drafts.edit("Look", in: "c")
    try drafts.add([DraftFile(name: "a.jpg", type: "image/jpeg", data: Data([1]))], to: "c", api: api)
    await drafts.idle()
    let file = try XCTUnwrap(drafts.draft(for: "c").files.first)
    XCTAssertTrue(file.failed)
    do { try await drafts.send(in: "c", api: api); XCTFail("sent with a failed upload") } catch DraftError.failedUpload {}
    try drafts.removeFile(file.id, in: "c")
    XCTAssertTrue(drafts.draft(for: "c").isReady)
  }

  func testAMessageCarriesAtMostTenFiles() async throws {
    let api = FeatureStub(), drafts = MessageDrafts()
    let files = (0..<12).map { DraftFile(name: "\($0).pdf", type: "application/pdf", data: Data([1])) }
    try drafts.add(files, to: "c", api: api)
    XCTAssertEqual(drafts.draft(for: "c").files.count, MessageLimits.files)
    await drafts.idle()
    let uploads = await api.uploads.count
    XCTAssertEqual(uploads, MessageLimits.files)
  }

  /// Adds one file to each conversation and waits until the first `paused` uploads are held.
  private func addFiles(to conversations: [String], pausing paused: Int, api: FeatureStub, drafts: MessageDrafts) async throws {
    for (index, id) in conversations.enumerated() {
      await api.enqueue("/conversations/\(id)/files", uploadedFile(id))
      if index < paused { await api.pause("/conversations/\(id)/files") }
    }
    for id in conversations {
      try drafts.add([DraftFile(name: "\(id).pdf", type: "application/pdf", data: Data([1]))], to: id, api: api)
    }
    for id in conversations.prefix(paused) { await api.started("/conversations/\(id)/files") }
  }

  func testAtMostTwoFilesUploadAtOnceAcrossConversations() async throws {
    let api = FeatureStub(), drafts = MessageDrafts()
    await api.pause("/conversations/c/files")
    try await addFiles(to: ["a", "b", "c"], pausing: 2, api: api, drafts: drafts)
    let running = await api.uploads.map(\.path)
    XCTAssertEqual(Set(running), ["/conversations/a/files", "/conversations/b/files"])
    await api.resume("/conversations/a/files")
    await api.started("/conversations/c/files")
    await api.resume("/conversations/b/files")
    await api.resume("/conversations/c/files")
    await drafts.idle()
    for id in ["a", "b", "c"] { XCTAssertEqual(drafts.draft(for: id).files.first?.uploaded?.id, id) }
  }

  func testClearingDraftsStopsTheirUploads() async throws {
    let api = FeatureStub(), drafts = MessageDrafts()
    try await addFiles(to: ["a", "b", "c"], pausing: 2, api: api, drafts: drafts)
    drafts.clear()
    await api.resume("/conversations/a/files")
    await api.resume("/conversations/b/files")
    await drafts.idle()
    // Let the cancelled uploads finish; neither may start the queued file.
    for _ in 0..<20 { await Task.yield() }
    let uploads = await api.uploads.map(\.path)
    XCTAssertEqual(Set(uploads), ["/conversations/a/files", "/conversations/b/files"])
    for id in ["a", "b", "c"] { XCTAssertTrue(drafts.draft(for: id).files.isEmpty) }
  }

  func testRemovingAFileStopsItsUploadAndFreesItsSlot() async throws {
    let api = FeatureStub(), drafts = MessageDrafts()
    await api.pause("/conversations/c/files")
    try await addFiles(to: ["a", "b", "c"], pausing: 2, api: api, drafts: drafts)
    let removed = try XCTUnwrap(drafts.draft(for: "a").files.first)
    try drafts.removeFile(removed.id, in: "a")
    // The queued file takes the slot while the other upload still runs.
    await api.started("/conversations/c/files")
    for id in ["a", "b", "c"] { await api.resume("/conversations/\(id)/files") }
    await drafts.idle()
    for _ in 0..<20 { await Task.yield() }
    XCTAssertTrue(drafts.draft(for: "a").files.isEmpty)
    XCTAssertEqual(drafts.draft(for: "b").files.first?.uploaded?.id, "b")
    XCTAssertEqual(drafts.draft(for: "c").files.first?.uploaded?.id, "c")
  }

  func testFilesCannotChangeWhileASendIsPending() async throws {
    let api = FeatureStub(), drafts = MessageDrafts()
    await api.enqueue("/conversations/c/files", uploadedFile("a"))
    try drafts.add([DraftFile(name: "a.pdf", type: "application/pdf", data: Data([1]))], to: "c", api: api)
    await drafts.idle()
    let file = try XCTUnwrap(drafts.draft(for: "c").files.first)
    await api.enqueue("/conversations/c/messages", message("m"))
    await api.pause("/conversations/c/messages")
    let send = Task { try await drafts.send(in: "c", api: api) }
    await api.started("/conversations/c/messages")
    XCTAssertThrowsError(try drafts.add([DraftFile(name: "b.pdf", type: "application/pdf", data: Data([2]))], to: "c", api: api)) {
      XCTAssertEqual($0 as? DraftError, .pendingMessage)
    }
    XCTAssertThrowsError(try drafts.removeFile(file.id, in: "c")) { XCTAssertEqual($0 as? DraftError, .pendingMessage) }
    XCTAssertEqual(drafts.draft(for: "c").files.map(\.id), [file.id])
    await api.resume("/conversations/c/messages")
    try await send.value
    let uploads = await api.uploads.count
    XCTAssertEqual(uploads, 1)
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
    XCTAssertEqual(sizes, [30, 30, 30, 15])
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

/// A download that runs until the test lets it finish.
@MainActor
private final class HeldDownload {
  private(set) var count = 0
  private var finished = false
  private var starts: [CheckedContinuation<Void, Never>] = []
  private var finishes: [CheckedContinuation<Void, Never>] = []
  func send(_ data: Data) async -> Data {
    count += 1
    starts.forEach { $0.resume() }; starts = []
    if !finished { await withCheckedContinuation { finishes.append($0) } }
    return data
  }
  func started() async { if count == 0 { await withCheckedContinuation { starts.append($0) } } }
  func finish() { finished = true; finishes.forEach { $0.resume() }; finishes = [] }
}

@MainActor
final class MessageFileCacheTests: XCTestCase {
  func testClearForgetsKeptBytes() async throws {
    let cache = MessageFileCache()
    cache.keep(Data([1]), for: "f")
    let kept = try await cache.data(for: "f") { XCTFail("Downloaded kept bytes"); return Data() }
    XCTAssertEqual(kept, Data([1]))
    cache.clear()
    var downloads = 0
    let fetched = try await cache.data(for: "f") { downloads += 1; return Data([2]) }
    XCTAssertEqual(fetched, Data([2]))
    XCTAssertEqual(downloads, 1)
  }

  func testCallersShareARunningDownload() async throws {
    let cache = MessageFileCache()
    let server = HeldDownload()
    let thumbnail = Task { try await cache.data(for: "f") { await server.send(Data([1])) } }
    let preview = Task { try await cache.data(for: "f") { await server.send(Data([2])) } }
    await server.started()
    server.finish()
    let results = try await [thumbnail.value, preview.value]
    XCTAssertEqual(results, [Data([1]), Data([1])])
    XCTAssertEqual(server.count, 1)
  }

  func testClearDropsRunningDownloads() async throws {
    let cache = MessageFileCache()
    let server = HeldDownload()
    let loading = Task { try await cache.data(for: "f") { await server.send(Data([1])) } }
    await server.started()
    cache.clear()
    server.finish()
    do { _ = try await loading.value; XCTFail("Finished a download clear() dropped") } catch is CancellationError {}
    let fetched = try await cache.data(for: "f") { Data([2]) }
    XCTAssertEqual(fetched, Data([2]))
  }

  func testCopiesKeepTheirExtensionWithinDiskNameLimits() async throws {
    let cache = MessageFileCache()
    defer { cache.clear() }
    // Three bytes each and without a decomposed form, so URLs report the same length.
    let name = String(repeating: "日", count: 100) + ".pdf"
    let file = MessageFile(id: UUID().uuidString, name: name, type: "application/octet-stream", size: 1, width: nil, height: nil)
    let url = try await cache.previewURL(for: file) { Data([1]) }
    XCTAssertLessThanOrEqual(url.lastPathComponent.utf8.count, 200)
    XCTAssertTrue(url.lastPathComponent.hasPrefix("日日"))
    XCTAssertEqual(url.pathExtension, "pdf")
    XCTAssertEqual(try Data(contentsOf: url), Data([1]))
    let hidden = MessageFile(id: UUID().uuidString, name: ".env", type: "application/octet-stream", size: 1, width: nil, height: nil)
    let copy = try await cache.previewURL(for: hidden) { Data([2]) }
    XCTAssertEqual(copy.lastPathComponent, "File")
  }

  func testCopiesStayInsideTheirFolder() async throws {
    let cache = MessageFileCache()
    let escape = FileManager.default.temporaryDirectory.appending(path: "escape", directoryHint: .isDirectory)
    try? FileManager.default.removeItem(at: escape)
    let file = MessageFile(id: "../escape", name: "x.pdf", type: "application/octet-stream", size: 1, width: nil, height: nil)
    do {
      _ = try await cache.previewURL(for: file) { XCTFail("Loaded a file with an invalid ID"); return Data([1]) }
      XCTFail("Accepted an ID that is not a UUID")
    } catch APIError.invalidResponse {}
    XCTAssertFalse(FileManager.default.fileExists(atPath: escape.path))
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
      #"{"id":"\#(id)","conversationId":"chat","senderId":"\#(sender)","clientId":"\#(id)","body":"hello","createdAt":"\#(createdAt)","hasAttachment":false,"files":[]}"#)
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

private final class SnapshotStub: @unchecked Sendable {
  private let lock = NSLock()
  private var values: [String: Data] = [:]
  func read(_ key: String) -> Data? { lock.withLock { values[key] } }
  func write(_ key: String, data: Data) { lock.withLock { values[key] = data } }
}

@MainActor
final class AccountStoreTests: XCTestCase {
  private func owner() throws -> Profile {
    try decode(#"{"id":"me","name":"Me","profileVisibility":"public","canViewContent":true,"followedBy":{"users":[],"total":0}}"#)
  }
  func testMessageFilesStayWithTheirAccount() async throws {
    // A copy left by a killed app never reaches the next session.
    let folder = FileManager.default.temporaryDirectory.appending(path: "message-files", directoryHint: .isDirectory)
    let leftover = folder.appending(path: "old/Left.pdf")
    try FileManager.default.createDirectory(at: leftover.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data([1]).write(to: leftover)
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    XCTAssertFalse(FileManager.default.fileExists(atPath: leftover.path))
    await api.enqueue("/conversations/chat/files", uploadedFile(UUID().uuidString, name: "menu.pdf"))
    try store.addFiles([DraftFile(name: "menu.pdf", type: "application/pdf", data: Data([7]))], to: "chat")
    await store.drafts.idle()
    let sent = try XCTUnwrap(store.drafts.draft(for: "chat").files.first?.uploaded)
    await api.enqueue("/conversations/chat/messages", message("m"))
    try await store.send(in: "chat")
    // The sender's own bytes open without a download.
    let data = try await store.data(for: sent, in: "chat")
    XCTAssertEqual(data, Data([7]))
    let preview = try await store.previewURL(for: sent, in: "chat")
    XCTAssertEqual(preview.lastPathComponent, "menu.pdf")
    XCTAssertEqual(try Data(contentsOf: preview), Data([7]))
    store.clear()
    XCTAssertFalse(FileManager.default.fileExists(atPath: folder.path))
    do { _ = try await store.data(for: sent, in: "chat"); XCTFail("Read a file after the account left") } catch is CancellationError {}
    let downloads = await api.downloads
    XCTAssertTrue(downloads.isEmpty)
  }
  func testResourcesRestoreSynchronouslyAndReuseAcrossNavigation() async throws {
    let api = FeatureStub()
    await api.snapshot("/feed/week", feed(["known"]))
    await api.snapshot("/conversations", page([conversation("chat")]))
    await api.snapshot("/conversations/chat/messages", page([message("known")]))
    let store = AccountStore(api: api, profile: try owner())
    XCTAssertEqual(store.feed("2026-01-01").feed?.own.items.first?.id, "known")
    XCTAssertTrue(store.feed("2026-01-01") === store.feed("2026-01-01"))
    XCTAssertEqual(store.inbox().conversations.first?.id, "chat")
    let chat = store.conversation("chat")
    XCTAssertEqual(chat.conversation?.id, "chat")
    XCTAssertEqual(chat.messages.first?.id, "known")
    XCTAssertTrue(chat === store.conversation("chat"))
    let initialCalls = await api.recorded()
    XCTAssertTrue(initialCalls.isEmpty)
  }
  func testOptimisticFavoriteRollsBackInEveryLoadedResource() async throws {
    let api = FeatureStub()
    await api.snapshot("/feed/week", feed(["known"]))
    let original: SavedLink = try decode(link("known"))
    let store = AccountStore(api: api, profile: try owner())
    let detail = store.link("known", opening: original)
    let week = store.feed("2026-01-01")
    await api.fail("/links/known/favorite", URLError(.notConnectedToInternet))
    await api.pause("/links/known/favorite")
    let write = Task { try await store.keep(original) }
    await api.started("/links/known/favorite")
    XCTAssertTrue(detail.link?.isFavorite == true)
    XCTAssertTrue(week.feed?.own.items.first?.isFavorite == true)
    await api.resume("/links/known/favorite")
    do { try await write.value; XCTFail("Expected failure") } catch {}
    XCTAssertFalse(detail.link?.isFavorite == true)
    XCTAssertFalse(week.feed?.own.items.first?.isFavorite == true)
  }
  func testAccountClearFencesLateProfileRollback() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    await api.fail("/me/profile", URLError(.networkConnectionLost))
    await api.pause("/me/profile")
    let edit = Task { try await store.editProfile(body: ["name": .string("Next")]) }
    await api.started("/me/profile")
    XCTAssertEqual(store.profile.name, "Next")
    store.clear()
    let erasedName = store.profile.name
    XCTAssertEqual(erasedName, "")
    await api.resume("/me/profile")
    do { _ = try await edit.value; XCTFail("Expected cancellation") } catch is CancellationError {} catch { XCTFail("Unexpected \(error)") }
    XCTAssertEqual(store.profile.name, erasedName)
    XCTAssertTrue(store.drafts.draft(for: "chat").isEmpty)
  }
  func testPulseRefreshesOnlyChangedListsAndStopsInBackground() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    store.active = true
    let pulse = #"{"messages":{"unreadCount":2,"version":"m1"},"activity":{"unreadCount":3,"version":"a1"}}"#
    await api.enqueue("/me/pulse", pulse)
    await api.enqueue("/conversations", page([conversation("chat")]))
    await api.enqueue("/me/activity", page([activity("a")], unread: true))
    try await store.pulse()
    XCTAssertEqual(store.unreadMessages, 2)
    XCTAssertEqual(store.unreadActivity, 3)
    let first = await api.recorded().count
    await api.enqueue("/me/pulse", pulse)
    try await store.pulse()
    let unchangedCalls = await api.recorded()
    XCTAssertEqual(unchangedCalls.count, first + 1)
    await api.enqueue("/me/pulse", pulse.replacingOccurrences(of: "a1", with: "a2"))
    await api.enqueue("/me/activity", page([activity("b")], unread: true))
    try await store.pulse()
    let calls = await api.recorded()
    XCTAssertEqual(calls.filter { $0.path == "/conversations" }.count, 1)
    XCTAssertEqual(calls.filter { $0.path == "/me/activity" }.count, 2)
    XCTAssertEqual(calls.filter { $0.path == "/me/activity/read" }.count, 0)
    store.active = false
    try await store.pulse()
    let backgroundCalls = await api.recorded()
    XCTAssertEqual(backgroundCalls.count, calls.count)
  }
  func testMissingPulseFallsBackToOlderEndpoints() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    store.active = true
    await api.fail("/me/pulse", APIError.server(404, "Missing"))
    await api.enqueue("/me/messages/unread", #"{"unreadCount":1}"#)
    await api.enqueue("/me/activity", page([], unread: true))
    await api.enqueue("/me/activity", page([], unread: true))
    await api.enqueue("/conversations", page([]))
    try await store.pulse()
    XCTAssertEqual(store.unreadMessages, 1)
    let legacyCalls = await api.recorded()
    XCTAssertEqual(legacyCalls.filter { $0.path == "/me/pulse" }.count, 1)
  }
  func testOnShowRefreshUsesAgeAndExplicitRefreshBypassesIt() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    var loads = 0
    try await store.show("test", path: "/test") { loads += 1 }
    try await store.show("test", path: "/test") { loads += 1 }
    XCTAssertEqual(loads, 1)
    try await store.show("test", path: "/test", force: true) { loads += 1 }
    XCTAssertEqual(loads, 2)
  }
}

@MainActor
final class OptimisticStoreTests: XCTestCase {
  private func owner() throws -> Profile {
    try decode(#"{"id":"me","name":"Me","profileVisibility":"public","canViewContent":true,"followingCount":2,"followedBy":{"users":[],"total":0}}"#)
  }
  func testSendAppearsBeforeResponseAndRetryPreservesBubbleIdentity() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    let summary: Conversation = try decode(conversation("chat"))
    let model = store.conversation("chat", opening: summary)
    store.drafts.edit("hello", in: "chat")
    await api.fail("/conversations/chat/messages", URLError(.networkConnectionLost))
    await api.pause("/conversations/chat/messages")
    let send = Task { try await store.send(in: "chat") }
    await api.started("/conversations/chat/messages")
    let pending = try XCTUnwrap(store.drafts.draft(for: "chat").pending)
    XCTAssertEqual(model.messages.first?.id, pending.clientID)
    XCTAssertEqual(model.sendStates[pending.clientID], "Sending…")
    let date = model.messages.first?.createdAt
    await api.resume("/conversations/chat/messages")
    do { try await send.value; XCTFail("Expected unknown outcome") } catch {}
    XCTAssertEqual(model.sendStates[pending.clientID], "Not confirmed · retry")
    let saved = message("server-id").replacingOccurrences(of: #""clientId":"client""#, with: #""clientId":"\#(pending.clientID)""#)
    await api.enqueue("/conversations/chat/messages", saved)
    await api.pause("/conversations/chat/messages")
    let retry = Task { try await store.send(in: "chat") }
    await api.started("/conversations/chat/messages")
    XCTAssertEqual(model.messages.first?.createdAt, date)
    await api.resume("/conversations/chat/messages")
    try await retry.value
    XCTAssertEqual(model.messages.map(\.id), ["server-id"])
    XCTAssertEqual(MessageTimeline.rows(model.messages).first?.id, pending.clientID)
    XCTAssertTrue(model.sendStates.isEmpty)
    XCTAssertTrue(store.drafts.draft(for: "chat").isEmpty)
    let calls = await api.recorded()
    let firstPayload = try JSONSerialization.jsonObject(with: payload(calls[0])) as? NSDictionary
    let retryPayload = try JSONSerialization.jsonObject(with: payload(calls[1])) as? NSDictionary
    XCTAssertEqual(firstPayload, retryPayload)
  }
  func testConfirmationReplacesThePendingBubbleWhenTheServerLowercasesTheID() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    let model = store.conversation("chat", opening: try decode(conversation("chat")))
    // The server stores client IDs as UUIDs and returns them in lowercase.
    await api.respond("/conversations/chat/messages") { body in
      guard case .string(let id)? = body?["clientId"] else { return "{}" }
      return message("server-id").replacingOccurrences(of: #""clientId":"client""#, with: #""clientId":"\#(id.lowercased())""#)
    }
    store.drafts.edit("hello", in: "chat")
    try await store.send(in: "chat")
    XCTAssertEqual(model.messages.map(\.id), ["server-id"])
    XCTAssertTrue(model.sendStates.isEmpty)
  }
  func testDeleteRestoresListPositionAndLinkEditsUseCanonicalResponse() async throws {
    let api = FeatureStub()
    await api.snapshot("/feed/week", feed(["a", "b"]))
    let store = AccountStore(api: api, profile: try owner())
    let original: SavedLink = try decode(link("a"))
    let model = store.link("a", opening: original)
    let week = store.feed("2026-01-01")
    await api.fail("/links/a", URLError(.notConnectedToInternet))
    await api.pause("/links/a")
    let deletion = Task { try await store.deleteLink(original) }
    await api.started("/links/a")
    XCTAssertEqual(week.feed?.own.items.map(\.id), ["b"])
    XCTAssertNil(model.link)
    await api.resume("/links/a")
    do { try await deletion.value; XCTFail("Expected rejection") } catch {}
    XCTAssertEqual(week.feed?.own.items.map(\.id), ["a", "b"])
    let canonical = link("a").replacingOccurrences(of: #""title":"a""#, with: #""title":"Canonical""#)
    await api.enqueue("/links/a", canonical)
    await api.pause("/links/a")
    let edit = Task { try await store.editLink(original, body: ["title": .string("Instant")]) }
    await api.started("/links/a")
    XCTAssertEqual(model.link?.title, "Instant")
    await api.resume("/links/a")
    try await edit.value
    XCTAssertEqual(model.link?.title, "Canonical")
    XCTAssertEqual(week.feed?.own.items.first?.title, "Canonical")
  }
  func testFollowAndGroupEditRollBackSharedFields() async throws {
    let api = FeatureStub()
    let person: Person = try decode(#"{"id":"them","name":"Them","profileVisibility":"public"}"#)
    let group: LinkGroup = try decode(#"{"id":"g","ownerId":"me","name":"Old","kind":"custom","visibility":"public"}"#)
    await api.snapshot("/discovery/recommendations", #"{"items":[{"id":"them","name":"Them","profileVisibility":"public"}]}"#)
    let store = AccountStore(api: api, profile: try owner())
    store.created(group)
    store.seed(person)
    await api.fail("/profiles/them/follow", URLError(.notConnectedToInternet))
    await api.pause("/profiles/them/follow")
    let follow = Task { try await store.follow(person) }
    await api.started("/profiles/them/follow")
    XCTAssertEqual(store.discovery.people.first?.followingStatus, "accepted")
    XCTAssertEqual(store.profile.followingCount, 3)
    await api.resume("/profiles/them/follow")
    do { try await follow.value; XCTFail("Expected rejection") } catch {}
    XCTAssertNil(store.discovery.people.first?.followingStatus)
    XCTAssertEqual(store.profile.followingCount, 2)
    await api.fail("/groups/g", URLError(.networkConnectionLost))
    await api.pause("/groups/g")
    let groupEdit = Task { try await store.editGroup(group, name: "New", visibility: .private) }
    await api.started("/groups/g")
    XCTAssertEqual(store.profileModel("me").groups.first?.name, "New")
    XCTAssertEqual(store.profileModel("me").groups.first?.visibility, .private)
    await api.resume("/groups/g")
    do { _ = try await groupEdit.value; XCTFail("Expected rejection") } catch {}
    XCTAssertEqual(store.profileModel("me").groups.first?.name, "Old")
    XCTAssertEqual(store.profileModel("me").groups.first?.visibility, .public)
  }
  func testCommentRollbackSurvivesAnOverlappingLinkPatch() async throws {
    let api = FeatureStub()
    let original: SavedLink = try decode(link("a"))
    let model = LinkModel(id: "a", api: api, opening: original)
    await api.fail("/links/a/comments", URLError(.notConnectedToInternet))
    await api.pause("/links/a/comments")
    let send = Task { try await model.addComment(id: "a", body: "Instant", author: self.owner().person, api: api) }
    await api.started("/links/a/comments")
    XCTAssertEqual(model.comments.first?.body, "Instant")
    var kept = original
    kept.isFavorite = true
    model.patch(kept)
    await api.resume("/links/a/comments")
    do { try await send.value; XCTFail("Expected rejection") } catch {}
    XCTAssertTrue(model.comments.isEmpty)
    XCTAssertTrue(model.link?.isFavorite == true)
  }
  func testFavoriteRemovalAndRollbackRestoreCollectionMembership() async throws {
    let api = FeatureStub()
    let kept = link("a").replacingOccurrences(of: #""isFavorite":false"#, with: #""isFavorite":true"#)
    await api.snapshot("/groups", page([#"{"id":"favorites","ownerId":"me","name":"Favorites","kind":"favorites","visibility":"public"}"#]))
    await api.snapshot("/groups/favorites/links", page([kept]))
    let store = AccountStore(api: api, profile: try owner())
    let model = store.profileWeek(userID: "me", week: "2026-01-01", filter: "favorites")
    let original: SavedLink = try decode(kept)
    await api.fail("/links/a/favorite", URLError(.networkConnectionLost))
    await api.pause("/links/a/favorite")
    let edit = Task { try await store.keep(original) }
    await api.started("/links/a/favorite")
    XCTAssertTrue(model.links.isEmpty)
    await api.resume("/links/a/favorite")
    do { try await edit.value; XCTFail("Expected rejection") } catch {}
    XCTAssertEqual(model.links.map(\.id), ["a"])
  }
}

@MainActor
final class ResourceRegressionTests: XCTestCase {
  private func owner() throws -> Profile {
    try decode(#"{"id":"me","name":"Me","profileVisibility":"public","canViewContent":true,"followerCount":3,"followingCount":2,"followedBy":{"users":[],"total":0}}"#)
  }
  private let person = #"{"id":"them","name":"Them","profileVisibility":"private","followingStatus":"accepted"}"#
  private let fullProfile = #"{"id":"them","name":"Full name","profileVisibility":"private","followingStatus":"accepted","canViewContent":true,"linkCount":5,"followedBy":{"users":[],"total":0}}"#

  func testSeedPrefersFullSnapshotAndLoadsMissingProfileResourcesImmediately() async throws {
    let api = FeatureStub()
    await api.snapshot("/profiles/them", fullProfile)
    let store = AccountStore(api: api, profile: try owner())
    store.seed(try decode(person))
    let model = store.profileModel("them")
    XCTAssertFalse(model.summaryOnly)
    XCTAssertEqual(model.profile?.name, "Full name")
    XCTAssertEqual(model.profile?.linkCount, 5)
    await api.enqueue("/profiles/them", fullProfile)
    await api.enqueue("/groups", page([]))
    await api.enqueue("/profiles/them/weeks", #"{"items":[],"nextBefore":null}"#)
    let loaded = try await store.refreshProfile("them")
    XCTAssertTrue(loaded)
    XCTAssertFalse(model.needsLoad)
    let fresh = try await store.refreshProfile("them")
    XCTAssertFalse(fresh)
    let calls = await api.recorded()
    XCTAssertEqual(calls.filter { $0.path == "/profiles/them" }.count, 1)
  }
  func testSummaryAndFailedProfilesAlwaysRetry() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    store.seed(try decode(person))
    XCTAssertTrue(store.profileModel("them").summaryOnly)
    await api.fail("/profiles/them", URLError(.notConnectedToInternet))
    await api.enqueue("/groups", page([]))
    do { _ = try await store.refreshProfile("them"); XCTFail("Expected failure") } catch {}
    await api.snapshot("/profiles/them", fullProfile)
    await api.enqueue("/profiles/them", fullProfile)
    await api.enqueue("/groups", page([]))
    await api.enqueue("/profiles/them/weeks", #"{"items":[],"nextBefore":null}"#)
    let retried = try await store.refreshProfile("them")
    XCTAssertTrue(retried)
    XCTAssertNil(store.profileModel("them").error)
  }
  func testClearingSearchRestoresRecommendationsAndWarmDoesNotReplaceSearch() async throws {
    let api = FeatureStub()
    await api.snapshot("/discovery/recommendations", #"{"items":[]}"#)
    let store = AccountStore(api: api, profile: try owner())
    try await store.refreshDiscovery("")
    await api.enqueue("/discovery/users?Them", "{\"items\":[" + person + "],\"nextAfter\":null}")
    try await store.refreshDiscovery(" Them ")
    XCTAssertEqual(store.discovery.query, "Them")
    XCTAssertEqual(store.discovery.people.first?.id, "them")
    store.active = true
    store.discoveryQuery = "Them"
    await store.warm()
    XCTAssertEqual(store.discovery.query, "Them")
    XCTAssertEqual(store.discovery.people.first?.id, "them")
    await api.enqueue("/discovery/recommendations", #"{"items":[]}"#)
    try await store.refreshDiscovery("")
    XCTAssertEqual(store.discovery.query, "")
    XCTAssertTrue(store.discovery.people.isEmpty)
    let calls = await api.recorded()
    XCTAssertEqual(calls.filter { $0.path == "/discovery/recommendations" }.count, 1)
  }
  func testUnfollowPatchesSharedCountsAndRollsBackConnectionMembership() async throws {
    let api = FeatureStub()
    await api.snapshot("/profiles/me/following", "{\"items\":[" + person + "],\"nextAfter\":null}")
    await api.snapshot("/profiles/them", fullProfile)
    await api.snapshot("/discovery/recommendations", "{\"items\":[" + person + "]}")
    let store = AccountStore(api: api, profile: try owner())
    let list = store.connections("following")
    let other = store.profileModel("them")
    await api.fail("/profiles/them/follow", URLError(.notConnectedToInternet))
    await api.pause("/profiles/them/follow")
    let edit = Task { try await store.follow(try decode(self.person)) }
    await api.started("/profiles/them/follow")
    XCTAssertTrue(list.people.isEmpty)
    XCTAssertEqual(store.profile.followingCount, 1)
    XCTAssertNil(store.discovery.people.first?.followingStatus)
    XCTAssertFalse(other.profile?.canViewContent == true)
    await api.resume("/profiles/them/follow")
    do { try await edit.value; XCTFail("Expected failure") } catch {}
    XCTAssertEqual(list.people.map(\.id), ["them"])
    XCTAssertEqual(store.profile.followingCount, 2)
    XCTAssertEqual(other.profile?.followingStatus, "accepted")
    XCTAssertEqual(other.profile?.linkCount, 5)
    await api.enqueue("/profiles/them/follow", #"{"success":true}"#)
    let privateLink: SavedLink = try decode(link("private").replacingOccurrences(of: #""ownerId":"me""#, with: #""ownerId":"them""#))
    let detail = store.link("private", opening: privateLink)
    try await store.follow(try decode(person))
    XCTAssertNil(detail.link)
  }
  func testRemovingFollowerIsImmediateRollsBackAndCannotRestoreAfterAccountClear() async throws {
    let api = FeatureStub()
    await api.snapshot("/profiles/me/followers", "{\"items\":[" + person + "],\"nextAfter\":null}")
    let store = AccountStore(api: api, profile: try owner())
    let list = store.connections("followers")
    for clear in [false, true] {
      await api.fail("/me/followers/them", URLError(.notConnectedToInternet))
      await api.pause("/me/followers/them")
      let edit = Task { try await store.removeFollower(try decode(self.person)) }
      await api.started("/me/followers/them")
      XCTAssertTrue(list.people.isEmpty)
      XCTAssertEqual(store.profile.followerCount, 2)
      if clear { store.clear() }
      await api.resume("/me/followers/them")
      do { try await edit.value; XCTFail("Expected failure") } catch {}
      if clear { XCTAssertTrue(list.people.isEmpty); XCTAssertNil(store.profile.followerCount) }
      else { XCTAssertEqual(list.people.map(\.id), ["them"]); XCTAssertEqual(store.profile.followerCount, 3) }
    }
  }
  func testQueryModelsAndResourceRetentionAreBoundedAndCurrentModelsReused() async throws {
    let store = AccountStore(api: FeatureStub(), profile: try owner())
    let inbox = store.inbox()
    let recipients = store.recipients()
    let firstInbox = store.inbox("first")
    let firstRecipients = store.recipients("first")
    for index in 0..<100 {
      _ = store.inbox("query-\(index)")
      _ = store.recipients("query-\(index)")
    }
    XCTAssertTrue(inbox === store.inbox())
    XCTAssertTrue(recipients === store.recipients())
    let current = store.inbox("query-99")
    XCTAssertTrue(current === store.inbox("query-99"))
    XCTAssertFalse(firstInbox === store.inbox("first"))
    XCTAssertFalse(firstRecipients === store.recipients("first"))
    let firstLink = store.link("first")
    let firstProfile = store.profileModel("first")
    store.openConversationID = "open"
    let open = store.conversation("open")
    let firstConversation = store.conversation("first")
    for index in 0..<100 {
      _ = store.link("link-\(index)")
      _ = store.profileModel("profile-\(index)")
      _ = store.conversation("chat-\(index)")
    }
    XCTAssertTrue(open === store.conversation("open"))
    XCTAssertFalse(firstLink === store.link("first"))
    XCTAssertFalse(firstProfile === store.profileModel("first"))
    XCTAssertFalse(firstConversation === store.conversation("first"))
  }
  func testMismatchedConversationSummaryIsIgnored() async throws {
    let store = AccountStore(api: FeatureStub(), profile: try owner())
    let wrong: Conversation = try decode(conversation("other"))
    XCTAssertNil(store.conversation("destination", opening: wrong).conversation)
  }
  func testGroupEditsNormalizeCustomNamesAndOmitSystemNames() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    let custom = #"{"id":"custom","ownerId":"me","name":"New name","kind":"custom","visibility":"private"}"#
    await api.enqueue("/groups/custom", custom)
    _ = try await store.editGroup(try decode(custom), name: "  New\t name  ", visibility: .private)
    let favorites = #"{"id":"favorites","ownerId":"me","name":"Favorites","kind":"favorites","visibility":"public"}"#
    await api.enqueue("/groups/favorites", favorites)
    _ = try await store.editGroup(try decode(favorites), name: "ignored", visibility: .public)
    let calls = await api.recorded()
    let customBody = try JSONSerialization.jsonObject(with: payload(calls[0])) as? NSDictionary
    XCTAssertEqual(customBody?["name"] as? String, "New name")
    XCTAssertNil(calls[1].body?["name"])
  }
}

@MainActor
final class ProvisionalSessionTests: XCTestCase {
  func testCachedAccountRendersWithoutVerificationOrAnyContentRequests() async throws {
    let api = FeatureStub()
    let identity: Profile = try decode(#"{"id":"me","name":"Me","profileVisibility":"public","canViewContent":true,"followedBy":{"users":[],"total":0}}"#)
    await api.snapshot("/feed/week", feed(["known"]))
    await api.snapshot("/conversations", page([conversation("chat")]))
    let session = AccountSession()
    session.provision(identity)
    let store = AccountStore(api: api, profile: identity, sessionVerified: false)
    store.active = true
    XCTAssertEqual(session.profile?.name, "Me")
    XCTAssertTrue(session.provisional)
    XCTAssertEqual(session.verifiedRevision, 0)
    XCTAssertEqual(store.feed(Week.monday()).feed?.own.items.first?.id, "known")
    XCTAssertEqual(store.inbox().conversations.first?.id, "chat")
    var loads = 0
    try await store.show("test", path: "/test", force: true) { loads += 1 }
    try await store.refreshInbox("")
    try await store.refreshActivity("all")
    try await store.refreshConversation("chat")
    try await store.refreshPreferences()
    try await store.pulse()
    await store.warm()
    XCTAssertEqual(loads, 0)
    let calls = await api.recorded()
    XCTAssertTrue(calls.isEmpty)
    let original: SavedLink = try decode(link("known"))
    do { try await store.keep(original); XCTFail("Provisional edit must wait for verification") } catch APIError.sessionNotVerified {}
    XCTAssertFalse(store.feed(Week.monday()).feed?.own.items.first?.isFavorite == true)
    store.drafts.edit("a draft", in: "chat")
    do { try await store.send(in: "chat"); XCTFail("Provisional send must wait for verification") } catch APIError.sessionNotVerified {}
    XCTAssertNil(store.drafts.draft(for: "chat").pending)
    let oldGeneration = session.generation
    try session.verified(identity, generation: oldGeneration)
    store.verifySession()
    XCTAssertEqual(session.generation, oldGeneration)
    XCTAssertFalse(session.provisional)
    XCTAssertEqual(session.verifiedRevision, 1)
    XCTAssertEqual(store.drafts.draft(for: "chat").body, "a draft")
    try await store.show("test", path: "/test", force: true) { loads += 1 }
    XCTAssertEqual(loads, 1)
    store.clear()
    session.clear()
    XCTAssertNil(session.profile)
    XCTAssertTrue(store.drafts.draft(for: "chat").isEmpty)
    XCTAssertFalse(store.sessionVerified)
  }
  func testProvisionalIdentityCannotConfirmAnotherAccountOrALateGeneration() throws {
    let identity = Profile.summary(.clearedAccount("alice"))
    let session = AccountSession()
    session.provision(identity)
    let generation = session.generation
    XCTAssertThrowsError(try session.verified(.summary(.clearedAccount("bob")), generation: generation))
    XCTAssertTrue(session.provisional)
    session.clear()
    XCTAssertThrowsError(try session.verified(identity, generation: generation))
    XCTAssertNil(session.profile)
    XCTAssertFalse(session.provisional)
  }
}

@MainActor
final class PulseFreshnessTests: XCTestCase {
  private func owner() throws -> Profile {
    try decode(#"{"id":"me","name":"Me","profileVisibility":"public","canViewContent":true,"followedBy":{"users":[],"total":0}}"#)
  }
  func testSuccessfulPulseSiblingDoesNotRefetchAfterAnotherListFails() async throws {
    let api = FeatureStub()
    let store = AccountStore(api: api, profile: try owner())
    store.active = true
    let pulse = #"{"messages":{"unreadCount":0,"version":"m1"},"activity":{"unreadCount":0,"version":"a1"}}"#
    await api.enqueue("/me/pulse", pulse)
    await api.enqueue("/conversations", page([conversation("chat")]))
    await api.fail("/me/activity", APIError.server(500, "Unavailable"))
    await api.pause("/me/activity")
    let first = Task { try await store.pulse() }
    await api.started("/me/activity")
    while !store.inbox().hasLoaded { await Task.yield() }
    for _ in 0..<20 { await Task.yield() }
    await api.resume("/me/activity")
    do { try await first.value; XCTFail("Expected failure") } catch {}
    await api.enqueue("/me/pulse", pulse)
    await api.enqueue("/me/activity", page([], unread: true))
    try await store.pulse()
    let calls = await api.recorded()
    XCTAssertEqual(calls.filter { $0.path == "/conversations" }.count, 1)
    XCTAssertEqual(calls.filter { $0.path == "/me/activity" }.count, 2)
  }
  func testOpeningConversationRefreshesWhenPulseChangedWhileItWasClosed() async throws {
    let api = FeatureStub()
    await api.snapshot("/conversations/chat", conversation("chat"))
    await api.snapshot("/conversations/chat/messages", page([message("old")]))
    let store = AccountStore(api: api, profile: try owner())
    let model = store.conversation("chat")
    store.active = true
    await api.enqueue("/me/pulse", #"{"messages":{"unreadCount":0,"version":"new"},"activity":{"unreadCount":0,"version":"a1"}}"#)
    await api.enqueue("/conversations", page([conversation("chat")]))
    await api.enqueue("/me/activity", page([], unread: true))
    try await store.pulse()
    XCTAssertEqual(model.messages.first?.id, "old")
    await api.enqueue("/conversations/chat", conversation("chat"))
    await api.enqueue("/conversations/chat/messages", page([message("new")]))
    await api.enqueue("/conversations/chat/read", #"{"success":true}"#)
    try await store.refreshConversation("chat")
    XCTAssertEqual(model.messages.first?.id, "new")
    let calls = await api.recorded()
    XCTAssertEqual(calls.filter { $0.path == "/conversations/chat/messages" }.count, 1)
  }
}
