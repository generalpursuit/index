import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class LinkModel {
  public private(set) var deleted = false
  public private(set) var link: SavedLink?
  public private(set) var author: Profile?
  public private(set) var group: LinkGroup?
  private let pages = CursorCollection<Comment>()
  public var comments: [Comment] { pages.items }
  public var cursor: String? { pages.cursor }
  public private(set) var loading = false
  public private(set) var error: String?
  private var generation = 0
  public init(id: String, api: any FeatureAPI, opening: SavedLink? = nil) {
    link = opening ?? api.snapshot("/links/\(id)", query: [:])
    if let link {
      author = api.snapshot("/profiles/\(link.ownerId)", query: [:])
      if let groupID = link.groupId { group = api.snapshot("/groups/\(groupID)", query: [:]) }
    }
    let comments: Page<Comment>? = api.snapshot("/links/\(id)/comments", query: ["limit": "30"])
    pages.restore(key: id, page: comments.map { CursorPage(items: $0.items, next: $0.nextCursor) })
  }
  public func clear() { generation += 1; link = nil; author = nil; group = nil; pages.reset(); deleted = true; loading = false; error = nil }
  func patch(_ value: SavedLink?) { generation += 1; loading = false; link = value; deleted = value == nil }
  public func load(id: String, api: any FeatureAPI) async throws {
    generation += 1
    let version = generation
    loading = link == nil
    error = nil
    defer { if version == generation { loading = false } }
    do {
      async let comments: Void = loadComments(id: id, api: api)
      let result: SavedLink = try await api.get("/links/\(id)")
      try Task.checkCancellation()
      guard version == generation else { return }
      link = result
      deleted = false
      loading = false
      async let profile: Profile = api.get("/profiles/\(result.ownerId)")
      async let group = loadGroup(result.groupId, api: api)
      try await comments
      let identity = try await profile
      let collection = try await group
      try Task.checkCancellation()
      guard version == generation else { return }
      author = identity
      self.group = collection
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if removesDisplayedContent(error) { link = nil; author = nil; group = nil; pages.reset() }
      self.error = error.localizedDescription
      throw error
    }
  }
  private func loadGroup(_ id: String?, api: any FeatureAPI) async throws -> LinkGroup? {
    guard let id else { return nil }
    return try await api.get("/groups/\(id)")
  }
  public func loadComments(id: String, api: any FeatureAPI, more: Bool = false) async throws {
    _ = try await pages.load(key: id, more: more, cached: { nil }, fetch: { cursor in
      var query = ["limit": "30"]
      query["cursor"] = cursor
      let page: Page<Comment> = try await api.get("/links/\(id)/comments", query: query)
      return CursorPage(items: page.items, next: page.nextCursor)
    })
  }
  public func addComment(id: String, body: String, author: Person, api: any FeatureAPI) async throws {
    let version = generation
    let pending = Comment.pending(linkID: id, author: author, body: body)
    pages.replace(comments + [pending])
    do {
      let saved: Comment = try await api.write("/links/\(id)/comments", body: ["body": .string(body)])
      try Task.checkCancellation()
      guard version == generation else { throw CancellationError() }
      pages.patch { $0.id == pending.id ? saved : $0 }
    } catch {
      guard version == generation else { throw CancellationError() }
      if removesDisplayedContent(error) { link = nil; pages.reset() }
      else { pages.patch { $0.id == pending.id ? nil : $0 } }
      self.error = error.localizedDescription
      throw error
    }
  }
  public func deleteComment(_ comment: Comment, api: any FeatureAPI) async throws {
    let old = comments
    let version = generation
    pages.patch { $0.id == comment.id ? nil : $0 }
    do {
      let _: Success = try await api.write("/comments/\(comment.id)", method: "DELETE")
      try Task.checkCancellation()
      guard version == generation else { throw CancellationError() }
    } catch {
      guard version == generation else { throw CancellationError() }
      if removesDisplayedContent(error) { link = nil; pages.reset() } else { pages.replace(old) }
      self.error = error.localizedDescription
      throw error
    }
  }
}
