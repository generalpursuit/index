import Foundation
import IndexCore
import Observation

/// One verified account owns these resources. Views select a resource synchronously;
/// leaving a screen neither discards its content nor starts another poller.
@MainActor @Observable
public final class AccountStore {
  public let accountID: String
  public private(set) var profile: Profile
  public private(set) var sessionVerified: Bool
  public let drafts = MessageDrafts()
  public let feedWeeks: FeedWeeksModel
  public let discovery: DiscoveryModel
  public private(set) var unreadMessages = 0
  public private(set) var unreadActivity = 0
  public private(set) var pulseError: String?
  public private(set) var notificationPreferences: NotificationPreferences?
  public var inboxQuery: String?
  public var activityFilter: String?
  public var discoveryQuery: String?
  public var conversationFocused = true
  public var openConversationID: String?
  public var active = false
  @ObservationIgnored private let api: any FeatureAPI
  @ObservationIgnored private var feeds: [String: FeedWeekModel] = [:]
  @ObservationIgnored private var profiles: [String: ProfileModel] = [:]
  @ObservationIgnored private var profileWeeks: [String: ProfileWeekModel] = [:]
  @ObservationIgnored private var inboxes: [String: ConversationListModel] = [:]
  @ObservationIgnored private var conversations: [String: ConversationModel] = [:]
  @ObservationIgnored private var activities: [String: ActivityModel] = [:]
  @ObservationIgnored private var recipientLists: [String: RecipientModel] = [:]
  @ObservationIgnored private var connectionLists: [String: ConnectionsModel] = [:]
  @ObservationIgnored private var links: [String: LinkModel] = [:]
  @ObservationIgnored private var shownAt: [String: Date] = [:]
  @ObservationIgnored private var accessedAt: [String: Date] = [:]
  @ObservationIgnored private var refreshing: Set<String> = []
  @ObservationIgnored private var pendingEdits: Set<String> = []
  @ObservationIgnored private var inboxVersions: [String: String] = [:]
  @ObservationIgnored private var activityVersions: [String: String] = [:]
  @ObservationIgnored private var conversationVersions: [String: String] = [:]
  @ObservationIgnored private var messageVersion: String?
  @ObservationIgnored private var activityVersion: String?
  @ObservationIgnored private var legacyPulse = false
  @ObservationIgnored private var pulsing = false
  @ObservationIgnored private var pulseQueued = false
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var accepted = true
  @ObservationIgnored private var summaryOnly: Bool
  @ObservationIgnored private let fileCache = MessageFileCache()

  public init(api: any FeatureAPI, profile: Profile, summaryOnly: Bool = false, sessionVerified: Bool = true) {
    self.api = api
    self.profile = profile
    self.summaryOnly = summaryOnly
    self.sessionVerified = sessionVerified
    accountID = profile.id
    notificationPreferences = api.snapshot("/me/notifications/preferences", query: [:])
    feedWeeks = FeedWeeksModel(api: api)
    discovery = DiscoveryModel(api: api)
    _ = feed(Week.monday())
    _ = profileModel(profile.id)
    _ = inbox()
    _ = activity()
  }
  public func verifySession() { guard accepted else { return }; sessionVerified = true }
  public func updateProfile(_ value: Profile) {
    guard accepted, value.id == accountID else { return }
    profile = value
    summaryOnly = false
    shownAt["settings-profile"] = .now
    for model in profiles.values where model.profile?.id == accountID { model.patchProfile(value) }
  }
  public func clear() {
    generation += 1
    accepted = false
    sessionVerified = false
    active = false
    drafts.clear()
    openConversationID = nil
    inboxQuery = nil
    activityFilter = nil
    discoveryQuery = nil
    unreadMessages = 0
    unreadActivity = 0
    feedWeeks.clear()
    discovery.clear()
    for model in feeds.values { model.clear() }
    for model in profiles.values { model.clear() }
    for model in profileWeeks.values { model.clear() }
    for model in inboxes.values { model.clear() }
    for model in conversations.values { model.clear() }
    for model in activities.values { model.clear() }
    for model in links.values { model.clear() }
    for model in recipientLists.values { model.clear() }
    for model in connectionLists.values { model.clear() }
    notificationPreferences = nil
    profile = .summary(.clearedAccount(accountID))
    // The detached store can never publish again; its views leave with session identity.
    feeds = [:]; profiles = [:]; profileWeeks = [:]; inboxes = [:]
    conversations = [:]; activities = [:]; links = [:]; recipientLists = [:]; connectionLists = [:]
    shownAt = [:]; accessedAt = [:]; refreshing = []; pendingEdits = []; conversationVersions = [:]; inboxVersions = [:]; activityVersions = [:]
    // Another account must never see these files.
    fileCache.clear()
  }
  /// Bound retained models as a session visits new resources. Clear evicted models too:
  /// a suspended load or an old view reference must not keep publishing private content.
  private func retain<Resource>(_ key: String, in resources: inout [String: Resource], prefix: String,
                                limit: Int = 32, keeping: Set<String> = [], clear: (Resource) -> Void) {
    accessedAt[prefix + key] = .now
    guard resources[key] == nil else { return }
    while resources.count >= limit {
      let candidate = resources.keys.filter {
        !keeping.contains($0) && !refreshing.contains(prefix + $0) && !pendingEdits.contains(prefix + $0)
      }.min { (accessedAt[prefix + $0] ?? .distantPast) < (accessedAt[prefix + $1] ?? .distantPast) }
      guard let candidate, let removed = resources.removeValue(forKey: candidate) else { break }
      clear(removed)
      accessedAt[prefix + candidate] = nil
      shownAt[prefix + candidate] = nil
      if prefix == "inbox:" { inboxVersions[candidate] = nil }
      if prefix == "conversation:" { conversationVersions[candidate] = nil }
    }
  }
  public func feed(_ week: String) -> FeedWeekModel {
    retain(week, in: &feeds, prefix: "feed:", clear: { $0.clear() })
    if let model = feeds[week] { return model }
    let model = FeedWeekModel(api: accepted ? api : DiscardedAccountAPI(), week: week)
    feeds[week] = model
    return model
  }
  public func profileModel(_ id: String, filter: String = "all", opening: Profile? = nil) -> ProfileModel {
    let key = id + ":" + filter
    retain(key, in: &profiles, prefix: "profile:", keeping: [accountID + ":all"], clear: { $0.clear() })
    if let model = profiles[key] { return model }
    let model = ProfileModel(api: accepted ? api : DiscardedAccountAPI(), userID: id, opening: accepted ? (opening ?? (id == accountID ? profile : nil)) : nil, summaryOnly: id == accountID && summaryOnly, filter: filter)
    profiles[key] = model
    return model
  }
  public func seed(_ person: Person) {
    guard accepted else { return }
    let key = person.id + ":all"
    retain(key, in: &profiles, prefix: "profile:", keeping: [accountID + ":all"], clear: { $0.clear() })
    guard profiles[key] == nil else { return }
    profiles[key] = ProfileModel(api: api, userID: person.id, opening: .summary(person), summaryOnly: true)
  }
  @discardableResult
  public func refreshProfile(_ id: String, filter: String = "all", force: Bool = false) async throws -> Bool {
    let model = profileModel(id, filter: filter)
    var applied = false
    try await show("profile:\(id):\(filter)", path: "/profiles/\(id)", force: force || model.needsLoad) {
      applied = try await model.load(api: self.api, userID: id, filter: filter)
    }
    return applied
  }
  public func refreshDiscovery(_ query: String, more: Bool = false) async throws {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let path = query.isEmpty ? "/discovery/recommendations" : "/discovery/users"
    let params = query.isEmpty ? [:] : ["query": query, "limit": "30"]
    try await show("discovery:" + query, path: path, query: params,
                   force: more || discovery.query != query || !discovery.hasLoaded || discovery.error != nil) {
      try await self.discovery.load(api: self.api, query: query, more: more)
    }
  }
  public func profileWeek(userID: String, week: String, filter: String) -> ProfileWeekModel {
    let key = userID + ":" + week + ":" + filter
    retain(key, in: &profileWeeks, prefix: "profile-week:", clear: { $0.clear() })
    if let model = profileWeeks[key] { return model }
    let model = ProfileWeekModel(api: accepted ? api : DiscardedAccountAPI(), userID: userID, week: week, filter: filter)
    profileWeeks[key] = model
    return model
  }
  public func recipients(_ query: String = "") -> RecipientModel {
    retain(query, in: &recipientLists, prefix: "recipients:", limit: 2, keeping: [""], clear: { $0.clear() })
    if let model = recipientLists[query] { return model }
    let model = RecipientModel(api: accepted ? api : DiscardedAccountAPI(), account: accountID, query: query)
    recipientLists[query] = model
    return model
  }
  public func connections(_ kind: String) -> ConnectionsModel {
    retain(kind, in: &connectionLists, prefix: "connections:", limit: 2, clear: { $0.clear() })
    if let model = connectionLists[kind] { return model }
    let model = ConnectionsModel(api: accepted ? api : DiscardedAccountAPI(), account: accountID, kind: kind)
    connectionLists[kind] = model
    return model
  }
  public func setPreferences(_ keys: [String], value: Bool) async throws {
    let key = "notification-preferences"
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    guard let old = notificationPreferences else { throw APIError.invalidResponse }
    var next = old
    for key in keys {
      switch key {
      case "message": next.message = value
      case "comment": next.comment = value
      case "mention": next.mention = value
      case "request": next.request = value
      case "follow": next.follow = value
      case "accepted": next.accepted = value
      case "previews": next.previews = value
      default: throw APIError.invalidResponse
      }
    }
    notificationPreferences = next
    do {
      let saved: NotificationPreferences = try await api.write("/me/notifications/preferences", method: "PATCH", body: Dictionary(uniqueKeysWithValues: keys.map { ($0, .bool(value)) }))
      try check(version)
      notificationPreferences = saved
    } catch {
      try check(version)
      notificationPreferences = old
      throw error
    }
  }
  public func refreshPreferences() async throws {
    try await show("notification-preferences", path: "/me/notifications/preferences", stable: true) {
      let value: NotificationPreferences = try await self.api.get("/me/notifications/preferences")
      guard self.accepted else { throw CancellationError() }
      self.notificationPreferences = value
    }
  }
  public func inbox(_ query: String = "") -> ConversationListModel {
    retain(query, in: &inboxes, prefix: "inbox:", limit: 2, keeping: [""], clear: { $0.clear() })
    if let model = inboxes[query] { return model }
    let model = ConversationListModel(api: accepted ? api : DiscardedAccountAPI(), query: query)
    inboxes[query] = model
    return model
  }
  public func refreshInbox(_ query: String, more: Bool = false, force: Bool = false) async throws {
    let model = inbox(query)
    var params = ["limit": "30"]
    if !query.isEmpty { params["query"] = query }
    let changed = inboxVersions[query] != messageVersion
    try await show("inbox:" + query, path: "/conversations", query: params, force: more || force || changed || model.error != nil) {
      try await model.load(api: self.api, query: query, more: more)
    }
    guard accepted else { throw CancellationError() }
    if let messageVersion { inboxVersions[query] = messageVersion }
  }
  public func refreshActivity(_ filter: String, more: Bool = false, force: Bool = false) async throws {
    let model = activity(filter)
    var params = ["limit": "30"]
    if filter != "all" { params["type"] = filter }
    let changed = activityVersions[filter] != activityVersion
    try await show("activity:" + filter, path: "/me/activity", query: params, force: more || force || changed || model.error != nil) {
      try await model.load(api: self.api, filter: filter, more: more, acknowledge: false)
    }
    guard accepted else { throw CancellationError() }
    if let activityVersion { activityVersions[filter] = activityVersion }
    try await readActivity(filter: filter)
  }
  public func conversation(_ id: String, opening: Conversation? = nil) -> ConversationModel {
    let kept = Set(conversations.keys.filter { drafts.isSending($0) }).union(openConversationID.map { [$0] } ?? [])
    retain(id, in: &conversations, prefix: "conversation:", keeping: kept, clear: { $0.clear() })
    if let model = conversations[id] { return model }
    let summary = (opening?.id == id ? opening : nil) ?? inboxes.values.flatMap(\.conversations).first { $0.id == id }
    let model = ConversationModel(api: accepted ? api : DiscardedAccountAPI(), id: id, opening: accepted ? summary : nil)
    conversations[id] = model
    return model
  }
  public func refreshConversation(_ id: String, opening: Conversation? = nil) async throws {
    let model = conversation(id, opening: opening)
    let changedWhileClosed = conversationVersions[id] != messageVersion
    try await show("conversation:" + id, path: "/conversations/\(id)", force: changedWhileClosed || model.error != nil) {
      try await model.load(api: self.api, id: id, opening: opening)
    }
    guard accepted else { throw CancellationError() }
    if let messageVersion { conversationVersions[id] = messageVersion }
  }
  public func activity(_ filter: String = "all") -> ActivityModel {
    retain(filter, in: &activities, prefix: "activity:", limit: 8, keeping: ["all"], clear: { $0.clear() })
    if let model = activities[filter] { return model }
    let model = ActivityModel(api: accepted ? api : DiscardedAccountAPI(), filter: filter)
    activities[filter] = model
    return model
  }
  public func prefetch(_ link: SavedLink) async {
    guard active, accepted, sessionVerified else { return }
    let model = self.link(link.id, opening: link)
    try? await show("link:" + link.id, path: "/links/\(link.id)") { try await model.load(id: link.id, api: self.api) }
  }
  public func link(_ id: String, opening: SavedLink? = nil) -> LinkModel {
    retain(id, in: &links, prefix: "link:", clear: { $0.clear() })
    if let model = links[id] { return model }
    let model = LinkModel(id: id, api: accepted ? api : DiscardedAccountAPI(), opening: accepted ? opening : nil)
    links[id] = model
    return model
  }
  /// Freshness is independent of view identity. Explicit refresh and changed pulse
  /// versions bypass age; ordinary appearances use accepted response timestamps.
  public func show(_ key: String, path: String, query: [String: String] = [:], stable: Bool = false,
                   force: Bool = false, load: @MainActor () async throws -> Void) async throws {
    guard accepted, sessionVerified, !refreshing.contains(key) else { return }
    let last = shownAt[key] ?? api.snapshotDate(path, query: query)
    if !force, let last, Date().timeIntervalSince(last) < (stable ? 300 : 30) { return }
    refreshing.insert(key)
    let version = generation
    defer { if version == generation { refreshing.remove(key) } }
    try await load()
    try Task.checkCancellation()
    guard accepted, version == generation else { throw CancellationError() }
    shownAt[key] = .now
    if shownAt.count > 256, let oldest = shownAt.min(by: { $0.value < $1.value })?.key { shownAt[oldest] = nil }
  }
  public func readActivity(filter: String) async throws {
    guard accepted, sessionVerified else { return }
    let model = activity(filter)
    let count = model.items.filter { $0.readAt == nil }.count
    let version = generation
    try await model.markRead(api: api)
    try check(version)
    unreadActivity = max(0, unreadActivity - count)
  }
  public func warm() async {
    guard active, accepted, sessionVerified else { return }
    // Main screens only; callers suppress this on constrained networks.
    async let weeks: Void? = try? show("feed-weeks", path: "/feed/weeks", query: ["limit": "100"]) {
      try await self.feedWeeks.load(api: self.api, selectedWeek: Week.monday())
    }
    async let people: Void = warmDiscovery()
    async let library: Bool? = try? refreshProfile(accountID)
    _ = await (weeks, people, library)
  }
  private func warmDiscovery() async {
    guard discovery.query.isEmpty, (discoveryQuery ?? "").isEmpty else { return }
    try? await refreshDiscovery("")
  }
  public func pulse() async throws {
    guard active, accepted, sessionVerified else { return }
    if pulsing { pulseQueued = true; return }
    pulsing = true
    let version = generation
    defer {
      if version == generation {
        pulsing = false
        if pulseQueued {
          pulseQueued = false
          Task { try? await self.pulse() }
        }
      }
    }
    do {
      let messagesChanged: Bool
      let activityChanged: Bool
      if !legacyPulse {
        do {
          let value: Pulse = try await api.get("/me/pulse")
          try Task.checkCancellation()
          guard active, accepted, version == generation else { return }
          unreadMessages = value.messages.unreadCount
          unreadActivity = value.activity.unreadCount
          messagesChanged = messageVersion != value.messages.version
          activityChanged = activityVersion != value.activity.version
          // Each successful list advances independently. A failing sibling does not
          // make the next pulse repeat reads that already reached the right version.
          try await refreshLive(messages: messagesChanged, activity: activityChanged, messageVersion: value.messages.version, activityVersion: value.activity.version)
          guard active, accepted, version == generation else { return }
          pulseError = nil
          return
        } catch APIError.server(404, _) { legacyPulse = true }
      }
      async let count: UnreadCount = api.get("/me/messages/unread")
      async let activity: ActivityPage = api.get("/me/activity", query: ["limit": "1"])
      let value = try await (count, activity)
      try Task.checkCancellation()
      guard active, accepted, version == generation else { return }
      unreadMessages = value.0.unreadCount
      unreadActivity = value.1.unreadCount
      try await refreshLive(messages: true, activity: true)
      pulseError = nil
    } catch {
      guard accepted, version == generation, !Task.isCancelled else { return }
      pulseError = error.localizedDescription
      throw error
    }
  }
  private func refreshLive(messages: Bool, activity: Bool, messageVersion: String? = nil, activityVersion: String? = nil) async throws {
    async let inbox: Void = refreshMessages(changed: messages, version: messageVersion)
    async let events: Void = refreshActivity(changed: activity, version: activityVersion)
    _ = try await (inbox, events)
  }
  private func refreshMessages(changed: Bool, version: String? = nil) async throws {
    let accountVersion = generation
    guard changed, active, accepted else { return }
    let selected = Set(["", inboxQuery].compactMap { $0 })
    for query in selected {
      if let version, inboxVersions[query] == version { continue }
      try await inbox(query).load(api: api, query: query)
      try Task.checkCancellation()
      if let version { inboxVersions[query] = version }
    }
    if conversationFocused, let id = openConversationID { try await conversation(id).load(api: api, id: id) }
    try check(accountVersion)
    try Task.checkCancellation()
    guard active else { throw CancellationError() }
    if let version { messageVersion = version; if conversationFocused, let id = openConversationID { conversationVersions[id] = version } }
  }
  private func refreshActivity(changed: Bool, version: String? = nil) async throws {
    let accountVersion = generation
    guard changed, active, accepted else { return }
    let selected = Set(["all", activityFilter].compactMap { $0 })
    for filter in selected {
      if let version, activityVersions[filter] == version { continue }
      try await self.activity(filter).load(api: api, filter: filter, acknowledge: false)
      try Task.checkCancellation()
      if let version { activityVersions[filter] = version }
    }
    try check(accountVersion)
    try Task.checkCancellation()
    guard active else { throw CancellationError() }
    if let version { activityVersion = version }
  }

  private func check(_ version: Int) throws {
    guard accepted, generation == version else { throw CancellationError() }
  }
  private func beginEdit(_ key: String) throws -> Int {
    guard accepted else { throw CancellationError() }
    guard sessionVerified else { throw APIError.sessionNotVerified }
    guard pendingEdits.insert(key).inserted else { throw APIError.server(409, "Wait for this edit to finish before changing it again.") }
    return generation
  }
  private func dirtyContent() {
    shownAt = shownAt.filter { $0.key.hasPrefix("inbox") || $0.key.hasPrefix("conversation") || $0.key.hasPrefix("activity") }
  }
  private func patchLink(_ id: String, with value: SavedLink?) {
    let transform: (SavedLink) -> SavedLink? = { $0.id == id ? value : $0 }
    for model in feeds.values { model.patchLinks(transform) }
    let groups = profiles.values.flatMap(\.groups)
    for model in profileWeeks.values {
      model.patchLinks { link in
        guard link.id == id else { return link }
        guard let value, model.includes(value, groups: groups) else { return nil }
        return value
      }
      if let value, model.includes(value, groups: groups) { model.restoreDeleted(value) }
    }
    links[id]?.patch(value)
    dirtyContent()
  }
  public func keep(_ link: SavedLink) async throws {
    let key = "link:" + link.id
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    let own = link.ownerId == accountID
    var next = link
    if own { next.isFavorite.toggle() } else { next.isStarred.toggle() }
    patchLink(link.id, with: next)
    do {
      let _: Success = try await api.write("/links/\(link.id)/\(own ? "favorite" : "star")", method: (own ? next.isFavorite : next.isStarred) ? "PUT" : "DELETE")
      try check(version)
    } catch {
      try check(version)
      patchLink(link.id, with: removesDisplayedContent(error) ? nil : link)
      throw error
    }
  }
  public func editLink(_ original: SavedLink, body: [String: JSONValue]) async throws {
    let key = "link:" + original.id
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    var next = original
    if case .string(let value)? = body["title"] { next.title = value }
    if case .string(let value)? = body["url"] { next.url = value }
    if case .string(let value)? = body["description"] { next.description = value }
    if case .string(let value)? = body["groupId"] { next.groupId = value }
    if case .null? = body["groupId"] { next.groupId = nil }
    patchLink(original.id, with: next)
    do {
      let saved: SavedLink = try await api.write("/links/\(original.id)", method: "PATCH", body: body)
      try check(version)
      patchLink(original.id, with: saved)
    } catch {
      try check(version)
      patchLink(original.id, with: removesDisplayedContent(error) ? nil : original)
      throw error
    }
  }
  public func deleteLink(_ original: SavedLink) async throws {
    let key = "link:" + original.id
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    patchLink(original.id, with: nil)
    do {
      let _: Success = try await api.write("/links/\(original.id)", method: "DELETE")
      try check(version)
    } catch {
      try check(version)
      if !removesDisplayedContent(error) {
        // Lists no longer contain the removed row: restore their membership, too.
        links[original.id]?.patch(original)
        for model in feeds.values { model.restoreDeleted(original) }
        for model in profileWeeks.values { model.restoreDeleted(original) }
      }
      throw error
    }
  }
  public func follow(_ person: Person) async throws {
    let key = "follow:" + person.id
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    let old = profiles[person.id + ":all"]?.profile?.followingStatus ?? person.followingStatus
    let next = old == nil ? (person.profileVisibility == .private ? "pending" : "accepted") : nil
    let oldProfiles = profiles.values.compactMap { model in
      model.profile.flatMap { $0.id == person.id ? (model, $0) : nil }
    }
    let list = connectionLists["following"]
    let removedAt = old == nil ? nil : list?.remove(person.id)
    let removedPeople = old == nil ? [] : feeds.values.compactMap { model in
      model.removePerson(person.id).map { (model, $0.index, $0.person) }
    }
    patchFollow(id: person.id, status: next, previous: old)
    do {
      if old == nil {
        let saved: FollowState = try await api.write("/profiles/\(person.id)/follow")
        try check(version)
        patchFollow(id: person.id, status: saved.status, previous: next)
      } else {
        let _: Success = try await api.write("/profiles/\(person.id)/follow", method: "DELETE")
        try check(version)
      }
    } catch {
      try check(version)
      patchFollow(id: person.id, status: old, previous: next)
      if !removesDisplayedContent(error) {
        for (model, profile) in oldProfiles { model.patchProfile(profile) }
        if let removedAt { list?.restore(person, at: removedAt) }
        for (model, index, person) in removedPeople { model.restorePerson(person, at: index) }
      }
      throw error
    }
    if old != nil {
      if person.profileVisibility == .private {
        for model in links.values where model.link?.ownerId == person.id { model.clear() }
        for model in profileWeeks.values { model.hideOwner(person.id) }
      }
    }
  }
  public func removeFollower(_ person: Person) async throws {
    let key = "follower:" + person.id
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    let list = connectionLists["followers"]
    let index = list?.remove(person.id)
    let delta = profile.followerCount == 0 ? 0 : -1
    patchFollowerCount(delta)
    do {
      let _: Success = try await api.write("/me/followers/\(person.id)", method: "DELETE")
      try check(version)
    } catch {
      try check(version)
      patchFollowerCount(-delta)
      if !removesDisplayedContent(error), let index { list?.restore(person, at: index) }
      throw error
    }
  }
  private func patchFollowerCount(_ delta: Int) {
    if let count = profile.followerCount { profile.followerCount = max(0, count + delta) }
    for model in profiles.values where model.profile?.id == accountID { model.patchProfile(profile) }
    dirtyContent()
  }
  private func patchFollow(id: String, status: String?, previous: String?) {
    let delta = (status == "accepted" ? 1 : 0) - (previous == "accepted" ? 1 : 0)
    if let count = profile.followingCount { profile.followingCount = max(0, count + delta) }
    feedWeeks.following(profile.followingCount)
    for model in profiles.values where model.profile?.id == accountID { model.patchProfile(profile) }
    discovery.patchFollow(id: id, status: status)
    for model in connectionLists.values { model.patchFollow(id: id, status: status) }
    for model in recipientLists.values { model.patchFollow(id: id, status: status) }
    for model in feeds.values { model.patchFollow(id: id, status: status) }
    for model in profiles.values where model.profile?.id == id {
      if var value = model.profile {
        value.followingStatus = status
        value.canViewContent = value.profileVisibility == .public || status == "accepted" || id == accountID
        if !value.canViewContent { value.linkCount = nil }
        model.patchProfile(value)
      }
    }
    dirtyContent()
  }
  public func editProfile(body: [String: JSONValue]) async throws -> Profile {
    let key = "profile:" + accountID
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    let old = profile
    var next = old
    if case .string(let name)? = body["name"] { next.name = name }
    if case .string(let username)? = body["username"] { next.username = username }
    if case .string(let raw)? = body["profileVisibility"], let visibility = Visibility(rawValue: raw) { next.profileVisibility = visibility }
    profile = next
    for model in profiles.values where model.profile?.id == accountID { model.patchProfile(next) }
    do {
      let saved: Profile = try await api.write("/me/profile", method: "PATCH", body: body)
      try check(version)
      profile = saved
      for model in profiles.values where model.profile?.id == accountID { model.patchProfile(saved) }
      dirtyContent()
      return saved
    } catch {
      try check(version)
      profile = old
      for model in profiles.values where model.profile?.id == accountID { model.patchProfile(old) }
      throw error
    }
  }
  public func editGroup(_ original: LinkGroup, name: String, visibility: Visibility) async throws -> LinkGroup {
    let key = "group:" + original.id
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    var draft = GroupDraft(group: original)
    draft.name = name
    draft.locked = visibility == .private
    if let error = draft.validationError { throw APIError.server(422, error) }
    var next = original
    if draft.isCustom { next.name = draft.normalizedName }
    next.visibility = draft.visibility
    patchGroup(next)
    do {
      let saved: LinkGroup = try await api.write("/groups/\(original.id)", method: "PATCH", body: draft.body)
      try check(version)
      patchGroup(saved)
      return saved
    } catch {
      try check(version)
      patchGroup(original)
      throw error
    }
  }
  public func deleteGroup(_ original: LinkGroup) async throws {
    let key = "group:" + original.id
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    let affected = storedLinks().filter { $0.groupId == original.id }
    for model in profiles.values { model.patchGroups { $0.id == original.id ? nil : $0 } }
    for link in affected {
      var next = link
      next.groupId = nil
      patchLink(link.id, with: next)
      links[link.id]?.patchGroup(nil)
    }
    do {
      let _: Success = try await api.write("/groups/\(original.id)", method: "DELETE", body: ["deleteLinks": .bool(false)])
      try check(version)
      dirtyContent()
    } catch {
      try check(version)
      for model in profiles.values where model.profile?.id == original.ownerId { model.created(original) }
      for link in affected {
        var restored = storedLinks().first(where: { $0.id == link.id }) ?? link
        restored.groupId = original.id
        patchLink(link.id, with: restored)
        links[link.id]?.patchGroup(original)
      }
      throw error
    }
  }
  private func storedLinks() -> [SavedLink] {
    unique(links.values.compactMap(\.link) + feeds.values.flatMap { ($0.feed?.own.items ?? []) + ($0.feed?.people.flatMap { $0.links.items } ?? []) } + profileWeeks.values.flatMap(\.links))
  }
  public func added(_ link: SavedLink) {
    guard accepted, link.ownerId == accountID else { return }
    for (week, model) in feeds where week == Week.monday(Week.date(link.savedOn)) { model.added(link) }
    dirtyContent()
  }
  public func resolve(_ activity: Activity, accept: Bool) async throws {
    let key = "request:" + activity.actor.id
    let version = try beginEdit(key)
    defer { if version == generation { pendingEdits.remove(key) } }
    for model in activities.values { model.patchRequest(actor: activity.actor.id, status: accept ? "accepted" : "declined") }
    do {
      if accept {
        let _: FollowState = try await api.write("/me/follow-requests/\(activity.actor.id)/accept")
      } else {
        let _: Success = try await api.write("/me/follow-requests/\(activity.actor.id)", method: "DELETE")
      }
      try check(version)
      dirtyContent()
    } catch {
      try check(version)
      for model in activities.values { model.patchRequest(actor: activity.actor.id, status: activity.requestStatus) }
      throw error
    }
  }
  public func refreshGroups(force: Bool = false) async throws {
    try await show("groups:" + accountID, path: "/groups", query: ["ownerId": accountID, "limit": "100"], force: force) {
      let result = try await loadGroups(api: self.api, ownerID: self.accountID)
      guard self.accepted else { throw CancellationError() }
      self.profileModel(self.accountID).setGroups(result)
    }
  }
  public func created(_ group: LinkGroup) { guard accepted else { return }; for model in profiles.values where model.profile?.id == group.ownerId { model.created(group) }; dirtyContent() }
  private func patchGroup(_ group: LinkGroup) {
    for model in profiles.values { model.patchGroups { $0.id == group.id ? group : $0 } }
    for model in links.values where model.link?.groupId == group.id { model.patchGroup(group) }
    dirtyContent()
  }
  /// Adds files to a conversation's draft and uploads them.
  public func addFiles(_ files: [DraftFile], to id: String) throws {
    guard accepted else { throw CancellationError() }
    guard sessionVerified else { throw APIError.sessionNotVerified }
    try drafts.add(files, to: id, api: api)
  }
  /// A sent file's bytes, kept in memory for the session while the cache has room.
  public func data(for file: MessageFile, in conversationID: String) async throws -> Data {
    // The client is shared, so a stale view would download with the next account's token.
    guard accepted else { throw CancellationError() }
    let version = generation
    return try await fileCache.data(for: file.id) { [self] in
      let data = try await api.download("/conversations/\(conversationID)/files/\(file.id)")
      // An account change while downloading must not leave this account's bytes behind.
      try check(version)
      return data
    }
  }
  /// A private local copy under the file's own name, for Quick Look.
  public func previewURL(for file: MessageFile, in conversationID: String) async throws -> URL {
    guard accepted else { throw CancellationError() }
    return try await fileCache.previewURL(for: file) { try await data(for: file, in: conversationID) }
  }
  public func send(in id: String) async throws {
    guard accepted else { throw CancellationError() }
    guard sessionVerified else { throw APIError.sessionNotVerified }
    let version = generation
    let model = conversation(id)
    try await drafts.send(in: id, api: api, started: { pending, draft in
      model.patch(.pending(clientID: pending.clientID, conversationID: id, senderID: self.accountID,
        body: pending.body, attachment: draft.attachment, files: pending.files, reply: draft.replyTo))
      // The sender's own bytes are already here, so their sent files open without a download.
      for file in draft.files { if let sent = file.uploaded { self.fileCache.keep(file.data, for: sent.id) } }
    }, completed: { saved in
      guard self.accepted, self.generation == version else { return }
      model.patch(saved)
      if var summary = model.conversation {
        summary.lastMessage = saved
        summary.updatedAt = saved.createdAt
        for list in self.inboxes.values { list.patch(summary) }
      }
    }, failed: { pending, error in
      guard self.accepted, self.generation == version else { return }
      if rejectsMessage(error) {
        model.removePending(pending.clientID)
      } else if removesDisplayedContent(error) { model.removePending(pending.clientID) }
      else { model.failPending(pending.clientID) }
    })
  }
}
