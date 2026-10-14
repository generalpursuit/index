import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class DiscoveryModel {
  public private(set) var people: [Person] = []
  public private(set) var after: String?
  public private(set) var hasLoaded = false
  public private(set) var loading = false
  public private(set) var error: String?
  private var generation = 0
  public init(api: any FeatureAPI) {
    let cached: Recommendations? = api.snapshot("/discovery/recommendations", query: [:])
    people = cached?.items ?? []
    hasLoaded = cached != nil
  }
  public func clear() { generation += 1; people = []; after = nil; hasLoaded = false; loading = false; error = nil }
  func patchFollow(id: String, status: String?) {
    for i in people.indices where people[i].id == id { people[i].followingStatus = status }
  }
  public func load(api: any FeatureAPI, query: String, more: Bool = false) async throws {
    generation += 1
    let version = generation
    loading = !hasLoaded
    error = nil
    defer { if version == generation { loading = false } }
    do {
      let loaded: [Person]
      let cursor: String?
      if query.isEmpty {
        let page: Recommendations = try await api.get("/discovery/recommendations")
        loaded = page.items
        cursor = nil
      } else {
        var params = ["query": query, "limit": "30"]
        if more { params["after"] = after }
        let page: PeoplePage = try await api.get("/discovery/users", query: params)
        loaded = page.items
        cursor = page.nextAfter
      }
      try Task.checkCancellation()
      guard generation == version else { return }
      hasLoaded = true
      people = unique(more ? people + loaded : loaded)
      after = cursor
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if removesDisplayedContent(error) { people = []; after = nil }
      self.error = error.localizedDescription
      throw error
    }
  }
}
