import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class ActivityModel {
  private let pages = CursorCollection<Activity>()
  public var items: [Activity] { pages.items }
  public var cursor: String? { pages.cursor }
  public var loading: Bool { pages.loading }
  public var error: String? { pages.error ?? receiptError }
  private var receiptError: String?
  private var generation = 0
  public init() {}
  public func load(api: any FeatureAPI, filter: String, more: Bool = false) async throws {
    try Task.checkCancellation()
    if more && (pages.busy || pages.cursor == nil) { return }
    generation += 1
    let version = generation
    receiptError = nil
    var params = ["limit": "30"]
    if filter != "all" { params["type"] = filter }
    let parameters = params
    do {
      let applied = try await pages.load(key: filter, more: more, cached: {
        let page: ActivityPage? = await api.cached("/me/activity", query: parameters)
        return page.map { CursorPage(items: $0.items, next: $0.nextCursor) }
      }, fetch: { cursor in
        var params = parameters
        params["cursor"] = cursor
        let page: ActivityPage = try await api.get("/me/activity", query: params)
        return CursorPage(items: page.items, next: page.nextCursor)
      })
      guard applied, version == generation, !Task.isCancelled else { return }
      let ids = items.filter { $0.readAt == nil }.map(\.id)
      // The API accepts at most 100 IDs; a refreshed loaded extent can be larger.
      for offset in stride(from: 0, to: ids.count, by: 100) {
        let batch = Array(ids[offset..<min(offset + 100, ids.count)])
        let _: Success = try await api.write("/me/activity/read", body: ["ids": .strings(batch)])
        try Task.checkCancellation()
        guard version == generation else { return }
      }
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if removesDisplayedContent(error) { pages.reset() }
      receiptError = error.localizedDescription
      throw error
    }
  }
  public func resolve(_ activity: Activity, accept: Bool, api: any FeatureAPI) async throws {
    if accept {
      let _: FollowState = try await api.write("/me/follow-requests/\(activity.actor.id)/accept")
    } else {
      let _: Success = try await api.write("/me/follow-requests/\(activity.actor.id)", method: "DELETE")
    }
  }
}
