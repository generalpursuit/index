import Foundation
import IndexCore
import Observation

struct CursorPage<Item: Sendable>: Sendable {
  let items: [Item]
  let next: String?
}

/// Conversations, activity and profile lists share these cursor semantics. Network paths,
/// filters and mutations remain in their feature models. Refresh replays the loaded extent
/// and publishes atomically, so transient failures never discard previously loaded pages.
@MainActor @Observable
final class CursorCollection<Item: Identifiable & Sendable> {
  private(set) var items: [Item] = []
  private(set) var cursor: String?
  private(set) var error: String?
  private(set) var busy = false
  private(set) var hasLoaded = false
  var loading: Bool { busy && !hasLoaded }
  private var key = ""
  private var generation = 0
  private var pageCount = 1

  func restore(key: String, page: CursorPage<Item>?) {
    guard self.key != key || items.isEmpty else { return }
    self.key = key
    if let page { items = unique(page.items); cursor = page.next; hasLoaded = true }
  }
  func patch(_ transform: (Item) -> Item?) {
    invalidate()
    items = items.compactMap(transform)
  }
  func replace(_ items: [Item]) { invalidate(); self.items = unique(items) }

  func invalidate() {
    generation += 1
    busy = false
  }

  func reset() {
    invalidate()
    items = []
    cursor = nil
    error = nil
    busy = false
    pageCount = 1
    hasLoaded = false
  }

  @discardableResult
  func load(
    key: String, more: Bool,
    cached: @MainActor () async -> CursorPage<Item>?,
    fetch: @MainActor (String?) async throws -> CursorPage<Item>
  ) async throws -> Bool {
    try Task.checkCancellation()
    if self.key != key { reset(); self.key = key }
    if more && (busy || cursor == nil) { return false }
    generation += 1
    let version = generation
    busy = true
    error = nil
    defer { if version == generation { busy = false } }
    do {
      if !more && items.isEmpty, let snapshot = await cached() {
        try Task.checkCancellation()
        guard version == generation else { return false }
        items = unique(snapshot.items)
        hasLoaded = true
        cursor = snapshot.next
      }
      var loaded: [Item] = []
      var next = more ? cursor : nil
      var visited = Set<String>()
      var count = 0
      for _ in 0..<(more ? 1 : pageCount) {
        if let next, !visited.insert(next).inserted { throw APIError.invalidResponse }
        let page = try await fetch(next)
        try Task.checkCancellation()
        guard version == generation else { return false }
        loaded += page.items
        next = page.next
        count += 1
        if next == nil { break }
      }
      hasLoaded = true
      items = unique(more ? items + loaded : loaded)
      cursor = next
      pageCount = more ? pageCount + 1 : max(1, count)
      return true
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return false }
      if removesDisplayedContent(error) { items = []; cursor = nil; pageCount = 1 }
      self.error = error.localizedDescription
      throw error
    }
  }
}
