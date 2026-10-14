import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class ProfileWeekModel {
  private let pages = CursorCollection<SavedLink>()
  public var links: [SavedLink] { pages.items }
  public var cursor: String? { pages.cursor }
  public var hasLoaded: Bool { pages.hasLoaded }
  public var error: String? { pages.error }
  public init(api: (any FeatureAPI)? = nil, userID: String = "", week: String = "", filter: String = "all") {
    self.ownerID = userID
    self.week = week
    self.filter = filter
    let path = filter == "all" ? "/profiles/\(userID)/links" : "/groups/\(filter)/links"
    let page: Page<SavedLink>? = api?.snapshot(path, query: ["weekStart": week, "limit": "30"])
    pages.restore(key: path + ":" + week, page: page.map { CursorPage(items: $0.items, next: $0.nextCursor) })
  }
  public func clear() { pages.reset(); deleted = [:] }
  private let ownerID: String
  private let week: String
  private let filter: String
  private var deleted: [String: Int] = [:]
  func patchLinks(_ transform: (SavedLink) -> SavedLink?) {
    for (index, link) in links.enumerated() where transform(link) == nil { deleted[link.id] = index }
    pages.patch(transform)
  }
  func hideOwner(_ id: String) { if ownerID == id { pages.reset() } }
  func includes(_ link: SavedLink, groups: [LinkGroup]) -> Bool {
    guard Week.monday(Week.date(link.savedOn)) == Week.monday(Week.date(week)) else { return false }
    if filter == "all" { return link.ownerId == ownerID }
    switch groups.first(where: { $0.id == filter })?.kind {
    case "favorites": return link.ownerId == ownerID && link.isFavorite
    case "starred": return link.isStarred
    default: return link.groupId == filter
    }
  }
  func restoreDeleted(_ link: SavedLink) {
    guard let index = deleted.removeValue(forKey: link.id) else { return }
    var restored = links
    restored.insert(link, at: min(index, restored.count))
    pages.replace(restored)
  }
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
  public private(set) var summaryOnly = false
  public private(set) var profile: Profile?
  public private(set) var groups: [LinkGroup] = []
  public private(set) var groupsLoaded = false
  public var error: String? { profileError ?? weeksError }
  private var profileError: String?
  private var weeksError: String?
  public private(set) var loading = false
  private let pages = CursorCollection<LibraryWeek>()
  public var weeks: [LibraryWeek] { pages.items }
  public var nextBefore: String? { pages.cursor }
  public var needsLoad: Bool { profile == nil || summaryOnly || error != nil || (profile?.canViewContent == true && (!groupsLoaded || !pages.hasLoaded)) }
  private var generation = 0
  private var selectedFilter = "all"
  public init(api: (any FeatureAPI)? = nil, userID: String = "", opening: Profile? = nil, summaryOnly: Bool = false, filter: String = "all") {
    let cached: Profile? = api?.snapshot("/profiles/\(userID)", query: [:])
    self.summaryOnly = summaryOnly && cached == nil
    profile = summaryOnly ? (cached ?? opening) : (opening ?? cached)
    let cachedGroups: Page<LinkGroup>? = api?.snapshot("/groups", query: ["ownerId": userID, "limit": "100"])
    groups = cachedGroups?.items ?? []
    groupsLoaded = cachedGroups != nil
    var params = ["limit": "10"]
    if filter != "all" { params["groupId"] = filter }
    let weeks: LibraryWeeks? = api?.snapshot("/profiles/\(userID)/weeks", query: params)
    pages.restore(key: userID + ":" + filter, page: weeks.map { CursorPage(items: $0.items, next: $0.nextBefore) })
  }
  func patchProfile(_ value: Profile) { generation += 1; loading = false; summaryOnly = false; profile = value }
  func patchGroups(_ transform: (LinkGroup) -> LinkGroup?) { groups = groups.compactMap(transform) }
  public func clear() { generation += 1; profile = nil; groups = []; groupsLoaded = false; pages.reset(); loading = false; profileError = nil; weeksError = nil }
  func setGroups(_ groups: [LinkGroup]) { self.groups = unique(groups); groupsLoaded = true }
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
        loading = profile == nil
      }
      if groups.isEmpty {
        let snapshot: Page<LinkGroup>? = await api.cached("/groups", query: ["ownerId": userID, "limit": "100"])
        try Task.checkCancellation()
        guard version == generation else { return false }
        groups = snapshot?.items ?? []
      }
      async let availableGroups = loadGroups(api: api, ownerID: userID)
      let result: Profile = try await api.get("/profiles/\(userID)")
      try Task.checkCancellation()
      guard version == generation else { return false }
      profile = result
      summaryOnly = false
      guard result.canViewContent else {
        groups = []
        pages.reset()
        profileError = nil
        weeksError = nil
        return true
      }
      let available = try await availableGroups
      guard version == generation else { return false }
      groups = available
      groupsLoaded = true
      profileError = nil
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return false }
      if removesDisplayedContent(error) { profile = nil; groups = []; groupsLoaded = false; pages.reset(); weeksError = nil }
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

@MainActor @Observable
public final class ConnectionsModel {
  private let pages = CursorCollection<Person>()
  public var people: [Person] { pages.items }
  public var after: String? { pages.cursor }
  public var error: String? { pages.error }
  public var hasLoaded: Bool { pages.hasLoaded }
  private var generation = 0
  public init(api: any FeatureAPI, account: String, kind: String) {
    let page: PeoplePage? = api.snapshot("/profiles/\(account)/\(kind)", query: ["limit": "30"])
    pages.restore(key: kind, page: page.map { CursorPage(items: $0.items, next: $0.nextAfter) })
  }
  public func clear() { generation += 1; pages.reset() }
  public func load(api: any FeatureAPI, account: String, kind: String, more: Bool = false) async throws {
    try await pages.load(key: kind, more: more, cached: { nil }, fetch: { after in
      var query = ["limit": "30"]
      query["after"] = after
      let page: PeoplePage = try await api.get("/profiles/\(account)/\(kind)", query: query)
      return CursorPage(items: page.items, next: page.nextAfter)
    })
  }
  func remove(_ id: String) -> Int? {
    let index = people.firstIndex { $0.id == id }
    pages.patch { $0.id == id ? nil : $0 }
    return index
  }
  func restore(_ person: Person, at index: Int) {
    guard !people.contains(where: { $0.id == person.id }) else { return }
    var restored = people
    restored.insert(person, at: min(index, restored.count))
    pages.replace(restored)
  }
  func patchFollow(id: String, status: String?) {
    pages.patch { person in
      var next = person
      if person.id == id { next.followingStatus = status }
      return next
    }
  }
}
