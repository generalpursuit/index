import Foundation
import IndexCore
import Observation

/// A file added to a draft. It uploads as soon as a slot is free; its bytes stay for the tile
/// preview and then become the sender's cached copy of the sent file.
public struct DraftFile: Identifiable, Sendable {
  public let id = UUID().uuidString
  public let name: String
  public let type: String
  public let data: Data
  public let width: Int?
  public let height: Int?
  public internal(set) var uploaded: MessageFile?
  public internal(set) var failed = false
  public init(name: String, type: String, data: Data, width: Int? = nil, height: Int? = nil) {
    self.name = name; self.type = type; self.data = data; self.width = width; self.height = height
  }
  /// Whether the thread will show it as a photo once sent.
  public var isPhoto: Bool { MessageLimits.photoTypes.contains(type) }
  var upload: UploadFile { UploadFile(name: name, type: type, data: data) }
  var fields: [String: String] {
    guard let width, let height else { return [:] }
    return ["width": String(width), "height": String(height)]
  }
}

public struct PendingMessage: Equatable, Sendable {
  public let clientID: String
  public let body: String
  public let linkID: String?
  public let replyToMessageID: String?
  public let files: [MessageFile]
  var payload: [String: JSONValue] {
    var value: [String: JSONValue] = ["clientId": .string(clientID), "body": .string(body)]
    if let linkID { value["linkId"] = .string(linkID) }
    if let replyToMessageID { value["replyToMessageId"] = .string(replyToMessageID) }
    if !files.isEmpty { value["fileIds"] = .strings(files.map(\.id)) }
    return value
  }
}

public struct MessageDraft: Sendable {
  public private(set) var body = ""
  public private(set) var attachment: SavedLink?
  public private(set) var replyTo: MessageReply?
  public private(set) var files: [DraftFile] = []
  public private(set) var pending: PendingMessage?
  public var isEmpty: Bool {
    body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachment == nil && files.isEmpty
  }
  public var isReady: Bool { files.allSatisfy { $0.uploaded != nil } }
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
  mutating func add(_ added: [DraftFile]) throws -> [DraftFile] {
    guard pending == nil else { throw DraftError.pendingMessage }
    let fitting = Array(added.prefix(max(0, MessageLimits.files - files.count)))
    files += fitting
    return fitting
  }
  mutating func remove(file id: String) throws {
    guard pending == nil else { throw DraftError.pendingMessage }
    files.removeAll { $0.id == id }
  }
  /// Marks a file uploaded, or failed with nil. A file removed meanwhile stays removed.
  mutating func finish(file id: String, as uploaded: MessageFile?) {
    guard let index = files.firstIndex(where: { $0.id == id }) else { return }
    if let uploaded { files[index].uploaded = uploaded } else { files[index].failed = true }
  }
  mutating func prepare() throws -> PendingMessage {
    if let pending { return pending }
    guard !isEmpty else { throw DraftError.emptyMessage }
    guard isReady else { throw files.contains(where: \.failed) ? DraftError.failedUpload : DraftError.uploading }
    // Lowercase, as the server returns UUIDs: the confirmed message must match its pending bubble.
    let value = PendingMessage(
      clientID: UUID().uuidString.lowercased(), body: body.trimmingCharacters(in: .whitespacesAndNewlines),
      linkID: attachment?.id, replyToMessageID: replyTo?.id, files: files.compactMap(\.uploaded))
    pending = value
    return value
  }
  mutating func recover(from error: Error) {
    // Only definite validation rejection permits changing the attempted payload.
    if rejectsMessage(error) { pending = nil }
  }
}
public enum DraftError: LocalizedError, Equatable {
  case pendingMessage, emptyMessage, uploading, failedUpload, tooManyFiles
  /// Some offered files couldn't be read or were too large. One alert also says when others
  /// didn't fit.
  case couldNotAttach(tooLarge: Bool, tooMany: Bool)
  public var errorDescription: String? {
    switch self {
    case .pendingMessage: "Retry the pending message in this conversation before changing its attachments."
    case .emptyMessage: "Add a message or attachment first."
    case .uploading: "Wait for your attachments to finish uploading."
    case .failedUpload: "Remove the attachment that couldn’t upload, then send."
    case .tooManyFiles: "A message can carry up to \(MessageLimits.files) files."
    case .couldNotAttach(let tooLarge, let tooMany):
      ["Some files couldn’t be attached.",
       tooLarge ? "The limit is \(MessageLimits.fileBytes / 1_000_000) MB per file." : nil,
       tooMany ? DraftError.tooManyFiles.errorDescription : nil,
      ].compactMap { $0 }.joined(separator: " ")
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
  /// Files waiting for an upload slot, oldest first.
  @ObservationIgnored private var queued: [(conversationID: String, file: DraftFile, api: any FeatureAPI)] = []
  /// Running uploads by file ID.
  @ObservationIgnored private var uploads: [String: Task<Void, Never>] = [:]
  public init() {}
  public func draft(for conversationID: String) -> MessageDraft { values[conversationID] ?? MessageDraft() }
  public func isSending(_ conversationID: String) -> Bool { sending.contains(conversationID) }
  public func edit(_ body: String, in conversationID: String) { values[conversationID, default: MessageDraft()].edit(body) }
  public func attach(_ link: SavedLink?, to conversationID: String) throws {
    try values[conversationID, default: MessageDraft()].attach(link)
  }
  /// Adds files to a conversation's draft and queues their uploads. Uploads outlive the
  /// screen, like the draft itself; removing a file or clearing the drafts stops its upload.
  public func add(_ files: [DraftFile], to conversationID: String, api: any FeatureAPI) throws {
    let added = try values[conversationID, default: MessageDraft()].add(files)
    queued += added.map { (conversationID, $0, api) }
    startUploads()
  }
  public func removeFile(_ id: String, in conversationID: String) throws {
    try values[conversationID]?.remove(file: id)
    queued.removeAll { $0.file.id == id }
    uploads.removeValue(forKey: id)?.cancel()
    startUploads()
  }
  /// Two uploads at a time across all drafts, so neither the device nor the server holds
  /// many large files.
  private func startUploads() {
    while uploads.count < 2, !queued.isEmpty {
      let (conversationID, file, api) = queued.removeFirst()
      let version = generation
      uploads[file.id] = Task {
        let uploaded: MessageFile? = try? await api.upload(
          "/conversations/\(conversationID)/files", file: file.upload, fields: file.fields)
        // Removing the file or clearing the drafts cancelled this upload and freed its slot.
        guard !Task.isCancelled, version == generation else { return }
        uploads[file.id] = nil
        values[conversationID]?.finish(file: file.id, as: uploaded)
        startUploads()
      }
    }
  }
  /// Waits until no upload is running or queued. A finished upload starts the next queued
  /// one before it ends, so awaiting the running ones is enough.
  func idle() async {
    while let upload = uploads.values.first { await upload.value }
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
    // The client is shared, so a later upload would carry the next account's token.
    queued = []
    for upload in uploads.values { upload.cancel() }
    uploads = [:]
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
