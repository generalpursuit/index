import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class ActivityModel {
  private let pages = CursorCollection<Activity>()
  public var items: [Activity] { pages.items }
  public var cursor: String? { pages.cursor }
  public var hasLoaded: Bool { pages.hasLoaded }
  public var loading: Bool { pages.loading }
  public var error: String? { pages.error ?? receiptError }
  private var receiptError: String?
  private var generation = 0
  public init(api: (any FeatureAPI)? = nil, filter: String = "all") {
    var params = ["limit": "30"]
    if filter != "all" { params["type"] = filter }
    let page: ActivityPage? = api?.snapshot("/me/activity", query: params)
    pages.restore(key: filter, page: page.map { CursorPage(items: $0.items, next: $0.nextCursor) })
  }
  public func clear() { generation += 1; pages.reset(); receiptError = nil }
  public func load(api: any FeatureAPI, filter: String, more: Bool = false, acknowledge: Bool = true) async throws {
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
      guard acknowledge else { return }
      try await markRead(api: api)

    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if removesDisplayedContent(error) { pages.reset() }
      receiptError = error.localizedDescription
      throw error
    }
  }
  public func markRead(api: any FeatureAPI) async throws {
    let version = generation
    let ids = items.filter { $0.readAt == nil }.map(\.id)
    for offset in stride(from: 0, to: ids.count, by: 100) {
      let batch = Array(ids[offset..<min(offset + 100, ids.count)])
      let _: Success = try await api.write("/me/activity/read", body: ["ids": .strings(batch)])
      try Task.checkCancellation()
      guard version == generation else { return }
      let accepted = Set(batch)
      pages.patch { item in
        guard accepted.contains(item.id) else { return item }
        var next = item
        next.readAt = Date().formatted(.iso8601)
        return next
      }
    }
  }
  func patchRequest(actor: String, status: String?) {
    generation += 1
    pages.patch { item in
      guard item.actor.id == actor && item.type == "request" else { return item }
      var next = item
      next.requestStatus = status
      return next
    }
  }
  public func resolve(_ activity: Activity, accept: Bool, api: any FeatureAPI) async throws {
    let old = items
    let version = generation
    pages.patch { item in
      guard item.id == activity.id else { return item }
      var next = item
      next.requestStatus = accept ? "accepted" : "declined"
      return next
    }
    do {
      if accept {
        let _: FollowState = try await api.write("/me/follow-requests/\(activity.actor.id)/accept")
      } else {
        let _: Success = try await api.write("/me/follow-requests/\(activity.actor.id)", method: "DELETE")
      }
      try Task.checkCancellation()
      guard version == generation else { return }
    } catch {
      guard version == generation else { throw CancellationError() }
      if removesDisplayedContent(error) { pages.reset() } else { pages.replace(old) }
      receiptError = error.localizedDescription
      throw error
    }
  }
}
