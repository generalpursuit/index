import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class ConversationListModel {
  private let pages = CursorCollection<Conversation>()
  public var conversations: [Conversation] { pages.items }
  public var cursor: String? { pages.cursor }
  public var hasLoaded: Bool { pages.hasLoaded }
  public var loading: Bool { pages.loading }
  public var error: String? { pages.error }
  public init(api: (any FeatureAPI)? = nil, query: String = "") {
    var params = ["limit": "30"]
    if !query.isEmpty { params["query"] = query }
    let page: Page<Conversation>? = api?.snapshot("/conversations", query: params)
    pages.restore(key: query, page: page.map { CursorPage(items: $0.items, next: $0.nextCursor) })
  }
  public func clear() { pages.reset() }
  func patch(_ value: Conversation) { pages.replace(unique([value] + conversations.filter { $0.id != value.id })) }
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
  public init(api: (any FeatureAPI)? = nil, account: String = "", query: String = "") {
    var params = ["limit": "30"]
    if !query.isEmpty { params["query"] = query }
    let page: PeoplePage? = api?.snapshot("/profiles/\(account)/following", query: params)
    pages.restore(key: account + ":" + query, page: page.map { CursorPage(items: $0.items, next: $0.nextAfter) })
  }
  public var hasLoaded: Bool { pages.hasLoaded }
  public func clear() { pages.reset() }
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
  public var messages: [Message] {
    pending.values.sorted { $0.createdAt > $1.createdAt } + pages.items.filter { !pending.keys.contains($0.clientId) }
  }
  public private(set) var sendStates: [String: String] = [:]
  private var pending: [String: Message] = [:]
  public var cursor: String? { pages.cursor }
  public var hasLoaded: Bool { pages.hasLoaded }
  public var loading: Bool { busy && conversation == nil }
  public private(set) var error: String?
  private var generation = 0
  private var busy = false
  public init(api: (any FeatureAPI)? = nil, id: String = "", opening: Conversation? = nil) {
    conversation = opening ?? api?.snapshot("/conversations/\(id)", query: [:])
    let page: Page<Message>? = api?.snapshot("/conversations/\(id)/messages", query: ["limit": "30"])
    pages.restore(key: id, page: page.map { CursorPage(items: $0.items, next: $0.nextCursor) })
  }
  public func clear() { generation += 1; conversation = nil; pages.reset(); pending = [:]; sendStates = [:]; busy = false; error = nil }
  func patch(_ message: Message) {
    generation += 1
    busy = false
    if message.id == message.clientId {
      if pending[message.clientId] == nil { pending[message.clientId] = message }
      sendStates[message.clientId] = "Sending…"
    } else {
      pending[message.clientId] = nil
      sendStates[message.clientId] = nil
      pages.replace([message] + pages.items.filter { $0.clientId != message.clientId })
    }
  }
  func failPending(_ clientID: String) { sendStates[clientID] = "Not confirmed · retry" }
  func removePending(_ clientID: String) { pending[clientID] = nil; sendStates[clientID] = nil }
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
      // Restore both resources before suspending, then start their independent reads.
      // Any access rejection clears both; a partial response is never retained then.
      if messages.isEmpty {
        let cached: Page<Message>? = await api.cached("/conversations/\(id)/messages", query: ["limit": "30"])
        guard version == generation else { return }
        pages.restore(key: id, page: cached.map { CursorPage(items: $0.items, next: $0.nextCursor) })
      }
      async let detail: Conversation = api.get("/conversations/\(id)")
      async let refreshed = pages.load(key: id, more: more, cached: {
        let page: Page<Message>? = await api.cached("/conversations/\(id)/messages", query: ["limit": "30"])
        return page.map { CursorPage(items: $0.items, next: $0.nextCursor) }
      }, fetch: { cursor in
        var query = ["limit": "30"]
        query["cursor"] = cursor
        let page: Page<Message> = try await api.get("/conversations/\(id)/messages", query: query)
        return CursorPage(items: page.items, next: page.nextCursor)
      })
      let identity = try await detail
      let applied = try await refreshed
      guard applied, version == generation else { return }
      conversation = identity
      try Task.checkCancellation()
      guard version == generation else { return }
      for message in pages.items where pending[message.clientId] != nil {
        pending[message.clientId] = nil
        sendStates[message.clientId] = nil
      }
      if let newest = pages.items.first {
        let _: Success = try await api.write("/conversations/\(id)/read", body: ["messageId": .string(newest.id)])
      }
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if removesDisplayedContent(error) { conversation = nil; pages.reset(); pending = [:]; sendStates = [:] }
      self.error = error.localizedDescription
      throw error
    }
  }
}
