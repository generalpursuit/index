import Foundation
import IndexCore
import Observation

/// One verified account owns these resources. Views select a resource synchronously;
/// leaving a screen neither discards its content nor starts another poller.
@MainActor @Observable
public final class AccountStore {
  public let accountID: String
  public private(set) var profile: Profile
  public let drafts = MessageDrafts()
  public let feedWeeks: FeedWeeksModel
  public let discovery: DiscoveryModel
  public private(set) var unreadMessages = 0
  public private(set) var unreadActivity = 0
  public private(set) var pulseError: String?
  public var notificationPreferences: NotificationPreferences?
  public var openConversationID: String?
  public var active = false
  public var pulseInterval: Duration { openConversationID == nil ? .seconds(15) : .seconds(4) }
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
  @ObservationIgnored private var refreshing: Set<String> = []
  @ObservationIgnored private var pendingEdits: Set<String> = []
  @ObservationIgnored private var messageVersion: String?
  @ObservationIgnored private var activityVersion: String?
  @ObservationIgnored private var legacyPulse = false
  @ObservationIgnored private var pulsing = false
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var accepted = true
  @ObservationIgnored private var summaryOnly: Bool

  public init(api: any FeatureAPI, profile: Profile, summaryOnly: Bool = false) {
    self.api = api
    self.profile = profile
    self.summaryOnly = summaryOnly
    accountID = profile.id
    notificationPreferences = api.snapshot("/me/notifications/preferences", query: [:])
    feedWeeks = FeedWeeksModel(api: api)
    discovery = DiscoveryModel(api: api)
    _ = feed(Week.monday())
    _ = profileModel(profile.id)
    _ = inbox()
    _ = activity()
  }
  public func updateProfile(_ value: Profile) {
    guard accepted, value.id == accountID else { return }
    profile = value
    summaryOnly = false
    for model in profiles.values where model.profile?.id == accountID { model.patchProfile(value) }
  }
  public func clear() {
    generation += 1
    accepted = false
    active = false
    drafts.clear()
    openConversationID = nil
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
    shownAt = [:]; refreshing = []; pendingEdits = []
  }
  public func feed(_ week: String) -> FeedWeekModel {
    if let model = feeds[week] { return model }
    let model = FeedWeekModel(api: accepted ? api : DiscardedAccountAPI(), week: week)
    feeds[week] = model
    return model
  }
  public func profileModel(_ id: String, filter: String = "all", opening: Profile? = nil) -> ProfileModel {
    let key = id + ":" + filter
    if let model = profiles[key] { return model }
    let model = ProfileModel(api: accepted ? api : DiscardedAccountAPI(), userID: id, opening: accepted ? (opening ?? (id == accountID ? profile : nil)) : nil, summaryOnly: id == accountID && summaryOnly, filter: filter)
    profiles[key] = model
    return model
  }
  public func seed(_ person: Person) {
    guard accepted else { return }
    guard profiles[person.id + ":all"] == nil else { return }
    profiles[person.id + ":all"] = ProfileModel(api: accepted ? api : DiscardedAccountAPI(), userID: person.id, opening: .summary(person), summaryOnly: true)
  }
  public func profileWeek(userID: String, week: String, filter: String) -> ProfileWeekModel {
    let key = userID + ":" + week + ":" + filter
    if let model = profileWeeks[key] { return model }
    let model = ProfileWeekModel(api: accepted ? api : DiscardedAccountAPI(), userID: userID, week: week, filter: filter)
    profileWeeks[key] = model
    return model
  }
  public func recipients(_ query: String = "") -> RecipientModel {
    if let model = recipientLists[query] { return model }
    let model = RecipientModel(api: accepted ? api : DiscardedAccountAPI(), account: accountID, query: query)
    recipientLists[query] = model
    return model
  }
  public func connections(_ kind: String) -> ConnectionsModel {
    if let model = connectionLists[kind] { return model }
    let model = ConnectionsModel(api: accepted ? api : DiscardedAccountAPI(), account: accountID, kind: kind)
    connectionLists[kind] = model
    return model
  }
  public func refreshPreferences() async throws {
    try await show("notification-preferences", path: "/me/notifications/preferences", stable: true) {
      let value: NotificationPreferences = try await self.api.get("/me/notifications/preferences")
      guard self.accepted else { throw CancellationError() }
      self.notificationPreferences = value
    }
  }
  public func inbox(_ query: String = "") -> ConversationListModel {
    if let model = inboxes[query] { return model }
    let model = ConversationListModel(api: accepted ? api : DiscardedAccountAPI(), query: query)
    inboxes[query] = model
    return model
  }
  public func conversation(_ id: String, opening: Conversation? = nil) -> ConversationModel {
    if let model = conversations[id] { return model }
    let summary = opening ?? inboxes.values.flatMap(\.conversations).first { $0.id == id }
    let model = ConversationModel(api: accepted ? api : DiscardedAccountAPI(), id: id, opening: accepted ? summary : nil)
    conversations[id] = model
    return model
  }
  public func activity(_ filter: String = "all") -> ActivityModel {
    if let model = activities[filter] { return model }
    let model = ActivityModel(api: accepted ? api : DiscardedAccountAPI(), filter: filter)
    activities[filter] = model
    return model
  }
  public func link(_ id: String, opening: SavedLink? = nil) -> LinkModel {
    if let model = links[id] { return model }
    let model = LinkModel(id: id, api: accepted ? api : DiscardedAccountAPI(), opening: accepted ? opening : nil)
    links[id] = model
    return model
  }
  /// Freshness is independent of view identity. Explicit refresh and changed pulse
  /// versions bypass age; ordinary appearances use accepted response timestamps.
  public func show(_ key: String, path: String, query: [String: String] = [:], stable: Bool = false,
                   force: Bool = false, load: @MainActor () async throws -> Void) async throws {
    guard accepted, !refreshing.contains(key) else { return }
    let last = shownAt[key] ?? api.snapshotDate(path, query: query)
    if !force, let last, Date().timeIntervalSince(last) < (stable ? 300 : 30) { return }
    refreshing.insert(key)
    let version = generation
    defer { if version == generation { refreshing.remove(key) } }
    try await load()
    try Task.checkCancellation()
    guard accepted, version == generation else { throw CancellationError() }
    shownAt[key] = .now
  }
  public func readActivity(filter: String) async throws {
    let model = activity(filter)
    let count = model.items.filter { $0.readAt == nil }.count
    let version = generation
    try await model.markRead(api: api)
    try check(version)
    unreadActivity = max(0, unreadActivity - count)
  }
  public func warm() async {
    guard active, accepted else { return }
    // Main screens only; callers suppress this on constrained networks.
    async let weeks: Void? = try? show("feed-weeks", path: "/feed/weeks", query: ["limit": "100"]) {
      try await self.feedWeeks.load(api: self.api, selectedWeek: Week.monday())
    }
    async let people: Void? = try? show("discovery", path: "/discovery/recommendations") {
      try await self.discovery.load(api: self.api, query: "")
    }
    async let library: Void? = try? show("profile:" + accountID, path: "/profiles/\(accountID)") {
      _ = try await self.profileModel(self.accountID).load(api: self.api, userID: self.accountID, filter: "all")
    }
    _ = await (weeks, people, library)
  }
  public func pulse() async throws {
    guard active, accepted, !pulsing else { return }
    pulsing = true
    let version = generation
    defer { if version == generation { pulsing = false } }
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
          // Commit versions after all changed resources refreshed. Failed reads retry
          // on the next pulse even if the server's version did not change again.
          try await refreshLive(messages: messagesChanged, activity: activityChanged)
          guard active, accepted, version == generation else { return }
          messageVersion = value.messages.version
          activityVersion = value.activity.version
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
  private func refreshLive(messages: Bool, activity: Bool) async throws {
    async let inbox: Void = refreshMessages(changed: messages)
    async let events: Void = refreshActivity(changed: activity)
    _ = try await (inbox, events)
  }
  private func refreshMessages(changed: Bool) async throws {
    guard changed, active, accepted else { return }
    for (query, model) in inboxes { try await model.load(api: api, query: query) }
    if let id = openConversationID { try await conversation(id).load(api: api, id: id) }
  }
  private func refreshActivity(changed: Bool) async throws {
    guard changed, active, accepted else { return }
    for (filter, model) in activities { try await model.load(api: api, filter: filter, acknowledge: false) }
  }

  private func check(_ version: Int) throws {
    guard accepted, generation == version else { throw CancellationError() }
  }
  private func beginEdit(_ key: String) throws -> Int {
    guard accepted else { throw CancellationError() }
    guard pendingEdits.insert(key).inserted else { throw APIError.server(409, "Wait for this edit to finish before changing it again.") }
    return generation
  }
  private func dirtyContent() {
    shownAt = shownAt.filter { $0.key.hasPrefix("inbox") || $0.key.hasPrefix("conversation") || $0.key.hasPrefix("activity") }
  }
  private func patchLink(_ id: String, with value: SavedLink?) {
    let transform: (SavedLink) -> SavedLink? = { $0.id == id ? value : $0 }
    for model in feeds.values { model.patchLinks(transform) }
    for model in profileWeeks.values { model.patchLinks(transform) }
    links[id]?.patch(value)
    dirtyContent()
  }
  public func keep(_ link: SavedLink) async throws {
    let key = "link:" + link.id
    guard accepted, pendingEdits.insert(key).inserted else { return }
    let version = generation
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
    guard accepted, pendingEdits.insert(key).inserted else { return }
    let version = generation
    defer { if version == generation { pendingEdits.remove(key) } }
    let old = profiles[person.id + ":all"]?.profile?.followingStatus ?? person.followingStatus
    let next = old == nil ? (person.profileVisibility == .private ? "pending" : "accepted") : nil
    patchFollow(id: person.id, status: next)
    do {
      if old == nil {
        let saved: FollowState = try await api.write("/profiles/\(person.id)/follow")
        try check(version)
        patchFollow(id: person.id, status: saved.status)
      } else {
        let _: Success = try await api.write("/profiles/\(person.id)/follow", method: "DELETE")
        try check(version)
      }
    } catch {
      try check(version)
      patchFollow(id: person.id, status: old)
      throw error
    }
  }
  private func patchFollow(id: String, status: String?) {
    discovery.patchFollow(id: id, status: status)
    for model in profiles.values where model.profile?.id == id {
      if var value = model.profile { value.followingStatus = status; model.patchProfile(value) }
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
    var next = original
    next.name = name; next.visibility = visibility
    patchGroup(next)
    do {
      let saved: LinkGroup = try await api.write("/groups/\(original.id)", method: "PATCH", body: ["name": .string(name), "visibility": .string(visibility.rawValue)])
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
    for model in profiles.values { model.patchGroups { $0.id == original.id ? nil : $0 } }
    do {
      let _: Success = try await api.write("/groups/\(original.id)", method: "DELETE", body: ["deleteLinks": .bool(false)])
      try check(version)
      dirtyContent()
    } catch {
      try check(version)
      for model in profiles.values where model.profile?.id == original.ownerId { model.created(original) }
      throw error
    }
    // A successful deletion cannot roll back because a later membership read failed.
    for (week, model) in feeds { try? await model.load(api: api, week: week) }
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
    try await show("groups:" + accountID, path: "/groups", query: ["ownerId": accountID, "limit": "100"], stable: true, force: force) {
      let result = try await loadGroups(api: self.api, ownerID: self.accountID)
      guard self.accepted else { throw CancellationError() }
      self.profileModel(self.accountID).setGroups(result)
    }
  }
  public func created(_ group: LinkGroup) { guard accepted else { return }; for model in profiles.values where model.profile?.id == group.ownerId { model.created(group) }; dirtyContent() }
  private func patchGroup(_ group: LinkGroup) {
    for model in profiles.values { model.patchGroups { $0.id == group.id ? group : $0 } }
    dirtyContent()
  }
  public func send(in id: String) async throws {
    guard accepted else { throw CancellationError() }
    let version = generation
    let model = conversation(id)
    try await drafts.send(in: id, api: api, started: { pending, draft in
      model.patch(.pending(clientID: pending.clientID, conversationID: id, senderID: self.accountID,
        body: pending.body, attachment: draft.attachment, reply: draft.replyTo))
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
      if case APIError.server(let status, _) = error, (400..<500).contains(status) {
        model.removePending(pending.clientID)
      } else if removesDisplayedContent(error) { model.removePending(pending.clientID) }
      else { model.failPending(pending.clientID) }
    })
  }
}
