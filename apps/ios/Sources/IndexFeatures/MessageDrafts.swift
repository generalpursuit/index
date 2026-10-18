import Foundation
import IndexCore
import Observation

public struct PendingMessage: Equatable, Sendable {
  public let clientID: String
  public let body: String
  public let linkID: String?
  public let replyToMessageID: String?
  var payload: [String: JSONValue] {
    var value: [String: JSONValue] = ["clientId": .string(clientID), "body": .string(body)]
    if let linkID { value["linkId"] = .string(linkID) }
    if let replyToMessageID { value["replyToMessageId"] = .string(replyToMessageID) }
    return value
  }
}

public struct MessageDraft: Sendable {
  public private(set) var body = ""
  public private(set) var attachment: SavedLink?
  public private(set) var replyTo: MessageReply?
  public private(set) var pending: PendingMessage?
  public var isEmpty: Bool { body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachment == nil }
  public init() {}

  mutating func edit(_ body: String) {
    guard pending == nil else { return }
    self.body = body
  }
  mutating func attach(_ link: SavedLink?) throws {
    guard pending == nil else { throw DraftError.pendingMessage }
    attachment = link
  }
  mutating func reply(to message: MessageReply?) {
    guard pending == nil else { return }
    replyTo = message
  }
  mutating func prepare() throws -> PendingMessage {
    if let pending { return pending }
    guard !isEmpty else { throw DraftError.emptyMessage }
    // Lowercase, as the server returns UUIDs: the confirmed message must match its pending bubble.
    let value = PendingMessage(
      clientID: UUID().uuidString.lowercased(), body: body.trimmingCharacters(in: .whitespacesAndNewlines),
      linkID: attachment?.id, replyToMessageID: replyTo?.id)
    pending = value
    return value
  }
  mutating func recover(from error: Error) {
    // Only definite validation rejection permits changing the attempted payload.
    if rejectsMessage(error) { pending = nil }
  }
}
public enum DraftError: LocalizedError {
  case pendingMessage, emptyMessage
  public var errorDescription: String? {
    switch self {
    case .pendingMessage: "Retry the pending message in this conversation before attaching another link."
    case .emptyMessage: "Add a message or link first."
    }
  }
}

/// One account's in-memory drafts. Picker, composer and deep links all use the same
/// operations; no caller can replace a pending payload or its idempotency identity.
@MainActor @Observable
public final class MessageDrafts {
  private var values: [String: MessageDraft] = [:]
  private var sending: Set<String> = []
  private var generation = 0
  public init() {}
  public func draft(for conversationID: String) -> MessageDraft { values[conversationID] ?? MessageDraft() }
  public func isSending(_ conversationID: String) -> Bool { sending.contains(conversationID) }
  public func edit(_ body: String, in conversationID: String) { values[conversationID, default: MessageDraft()].edit(body) }
  public func attach(_ link: SavedLink?, to conversationID: String) throws {
    try values[conversationID, default: MessageDraft()].attach(link)
  }
  /// Quotes `message` in the next send, or stops quoting with nil. Like the text, the quote
  /// cannot change while a send is pending.
  public func reply(to message: Message?, in conversationID: String) {
    values[conversationID, default: MessageDraft()].reply(to: message.map(MessageReply.init(quoting:)))
  }
  public func clear() {
    generation += 1
    values = [:]
    sending = []
  }
  public func send(in conversationID: String, api: any FeatureAPI,
                   started: (PendingMessage, MessageDraft) -> Void = { _, _ in },
                   completed: (Message) -> Void = { _ in },
                   failed: (PendingMessage, Error) -> Void = { _, _ in }) async throws {
    guard !sending.contains(conversationID) else { return }
    let pending = try values[conversationID, default: MessageDraft()].prepare()
    let version = generation
    sending.insert(conversationID)
    started(pending, draft(for: conversationID))
    defer { if version == generation { sending.remove(conversationID) } }
    do {
      let saved: Message = try await api.write("/conversations/\(conversationID)/messages", body: pending.payload)
      try Task.checkCancellation()
      guard version == generation else { throw CancellationError() }
      completed(saved)
      values[conversationID] = nil
    } catch {
      guard version == generation else { throw CancellationError() }
      failed(pending, error)
      values[conversationID]?.recover(from: error)
      throw error
    }
  }
}

func rejectsMessage(_ error: Error) -> Bool {
  guard case APIError.server(let status, _) = error else { return false }
  // Timeout and throttling responses do not prove that an intermediary or delayed
  // operation did not commit. Keep the same identity for those uncertain outcomes.
  return [400, 403, 404, 409, 422].contains(status)
}
