import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class ProfileWeekModel {
  private let pages = CursorCollection<SavedLink>()
  public var links: [SavedLink] { pages.items }
  public var cursor: String? { pages.cursor }
  public var error: String? { pages.error }
  public init() {}
  public func load(api: any FeatureAPI, userID: String, week: String, filter: String, more: Bool = false) async throws {
    let path = filter == "all" ? "/profiles/\(userID)/links" : "/groups/\(filter)/links"
    let params = ["weekStart": week, "limit": "30"]
    try await pages.load(key: path + ":" + week, more: more, cached: {
      let page: Page<SavedLink>? = await api.cached(path, query: params)
      return page.map { CursorPage(items: $0.items, next: $0.nextCursor) }
    }, fetch: { cursor in
      var query = params
      query["cursor"] = cursor
      let page: Page<SavedLink> = try await api.get(path, query: query)
      return CursorPage(items: page.items, next: page.nextCursor)
    })
  }
}

@MainActor @Observable
public final class ProfileModel {
  public private(set) var profile: Profile?
  public private(set) var groups: [LinkGroup] = []
  public var error: String? { profileError ?? weeksError }
  private var profileError: String?
  private var weeksError: String?
  public private(set) var loading = false
  private let pages = CursorCollection<LibraryWeek>()
  public var weeks: [LibraryWeek] { pages.items }
  public var nextBefore: String? { pages.cursor }
  private var generation = 0
  private var selectedFilter = "all"
  public init() {}
  public func created(_ group: LinkGroup) { groups = unique(groups + [group]) }
  @discardableResult
  public func load(api: any FeatureAPI, userID: String, filter: String) async throws -> Bool {
    try Task.checkCancellation()
    generation += 1
    let version = generation
    selectedFilter = filter
    loading = profile == nil
    defer { if version == generation { loading = false } }
    do {
      if profile == nil {
        let snapshot: Profile? = await api.cached("/profiles/\(userID)", query: [:])
        try Task.checkCancellation()
        guard version == generation else { return false }
        profile = snapshot
      }
      if groups.isEmpty {
        let snapshot: Page<LinkGroup>? = await api.cached("/groups", query: ["ownerId": userID, "limit": "100"])
        try Task.checkCancellation()
        guard version == generation else { return false }
        groups = snapshot?.items ?? []
      }
      let result: Profile = try await api.get("/profiles/\(userID)")
      try Task.checkCancellation()
      guard version == generation else { return false }
      profile = result
      guard result.canViewContent else {
        groups = []
        pages.reset()
        profileError = nil
        weeksError = nil
        return true
      }
      let available = try await loadGroups(api: api, ownerID: userID)
      guard version == generation else { return false }
      groups = available
      profileError = nil
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return false }
      if removesDisplayedContent(error) { profile = nil; groups = []; pages.reset(); weeksError = nil }
      profileError = error.localizedDescription
      throw error
    }
    try await loadWeeks(api: api, userID: userID, filter: selectedFilter)
    return version == generation && !Task.isCancelled
  }
  public func loadWeeks(api: any FeatureAPI, userID: String, filter: String, more: Bool = false) async throws {
    try Task.checkCancellation()
    selectedFilter = filter
    guard profile?.canViewContent == true else { return }
    if filter == "starred" { pages.reset(); weeksError = nil; return }
    let path = "/profiles/\(userID)/weeks"
    var params = ["limit": "10"]
    if filter != "all" { params["groupId"] = filter }
    let parameters = params
    do {
      let applied = try await pages.load(key: userID + ":" + filter, more: more, cached: {
        let page: LibraryWeeks? = await api.cached(path, query: parameters)
        return page.map { CursorPage(items: $0.items, next: $0.nextBefore) }
      }, fetch: { before in
        var query = parameters
        query["before"] = before
        let page: LibraryWeeks = try await api.get(path, query: query)
        return CursorPage(items: page.items, next: page.nextBefore)
      })
      if applied { weeksError = nil }
    } catch {
      guard !Task.isCancelled, !(error is CancellationError) else { return }
      if removesDisplayedContent(error) { groups = []; pages.reset() }
      weeksError = error.localizedDescription
      throw error
    }
  }
}
