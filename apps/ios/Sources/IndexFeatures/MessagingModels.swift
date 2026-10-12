import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class ConversationListModel {
  private let pages = CursorCollection<Conversation>()
  public var conversations: [Conversation] { pages.items }
  public var cursor: String? { pages.cursor }
  public var loading: Bool { pages.loading }
  public var error: String? { pages.error }
  public init() {}
  public func load(api: any FeatureAPI, query: String, more: Bool = false) async throws {
    var params = ["limit": "30"]
    if !query.isEmpty { params["query"] = query }
    let parameters = params
    try await pages.load(key: query, more: more, cached: {
      let page: Page<Conversation>? = await api.cached("/conversations", query: parameters)
      return page.map { CursorPage(items: $0.items, next: $0.nextCursor) }
    }, fetch: { cursor in
      var params = parameters
      params["cursor"] = cursor
      let page: Page<Conversation> = try await api.get("/conversations", query: params)
      return CursorPage(items: page.items, next: page.nextCursor)
    })
  }
}

@MainActor @Observable
public final class RecipientModel {
  private let pages = CursorCollection<Person>()
  public var people: [Person] { pages.items }
  public var after: String? { pages.cursor }
  public var loading: Bool { pages.loading }
  public var error: String? { pages.error }
  public init() {}
  public func load(api: any FeatureAPI, account: String, query: String, more: Bool = false) async throws {
    try await pages.load(key: account + ":" + query, more: more, cached: { nil }, fetch: { after in
      var params = ["limit": "30"]
      if !query.isEmpty { params["query"] = query }
      params["after"] = after
      let page: PeoplePage = try await api.get("/profiles/\(account)/following", query: params)
      return CursorPage(items: page.items, next: page.nextAfter)
    })
  }
  public func create(api: any FeatureAPI, recipients: [Person]) async throws -> Conversation {
    try await api.write("/conversations", body: ["recipientIds": .strings(recipients.map(\.id))])
  }
}

@MainActor @Observable
public final class ConversationModel {
  public private(set) var conversation: Conversation?
  private let pages = CursorCollection<Message>()
  public var messages: [Message] { pages.items }
  public var cursor: String? { pages.cursor }
  public var loading: Bool { busy && conversation == nil }
  public private(set) var error: String?
  private var generation = 0
  private var busy = false
  public init() {}
  public func load(api: any FeatureAPI, id: String, opening: Conversation? = nil, more: Bool = false) async throws {
    try Task.checkCancellation()
    if more && (busy || pages.cursor == nil) { return }
    if !more { pages.invalidate() }
    generation += 1
    let version = generation
    busy = true
    error = nil
    defer { if version == generation { busy = false } }
    do {
      if conversation == nil {
        let snapshot: Conversation? = opening?.id == id ? opening : await api.cached("/conversations/\(id)", query: [:])
        try Task.checkCancellation()
        guard version == generation else { return }
        conversation = snapshot
      }
      // Fetch detail before publishing messages: a revoked conversation must never
      // display a successfully fetched partial response alongside stale participants.
      let detail: Conversation = try await api.get("/conversations/\(id)")
      try Task.checkCancellation()
      guard version == generation else { return }
      let applied = try await pages.load(key: id, more: more, cached: {
        let page: Page<Message>? = await api.cached("/conversations/\(id)/messages", query: ["limit": "30"])
        return page.map { CursorPage(items: $0.items, next: $0.nextCursor) }
      }, fetch: { cursor in
        var query = ["limit": "30"]
        query["cursor"] = cursor
        let page: Page<Message> = try await api.get("/conversations/\(id)/messages", query: query)
        return CursorPage(items: page.items, next: page.nextCursor)
      })
      guard applied, version == generation else { return }
      conversation = detail
      if let newest = messages.first {
        let _: Success = try await api.write("/conversations/\(id)/read", body: ["messageId": .string(newest.id)])
      }
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if removesDisplayedContent(error) { conversation = nil; pages.reset() }
      self.error = error.localizedDescription
      throw error
    }
  }
}
