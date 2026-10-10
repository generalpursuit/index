import IndexCore
import SwiftUI

struct ProfileView: View {
  let userID: String
  init(userID: String, groupID: String? = nil) {
    self.userID = userID
    _filter = State(initialValue: groupID ?? "all")
  }
  @Environment(AppModel.self) private var app
  @State private var profile: Profile?
  @State private var groups: [LinkGroup] = []
  @State private var creatingGroup = false
  @State private var filter = "all"
  @State private var weeks: [LibraryWeek] = []
  @State private var nextBefore: String?
  @State private var error: String?
  @State private var loading = true
  var own: Bool { userID == app.userID }
  var selected: LinkGroup? { groups.first { $0.id == filter } }
  // Starred holds other people's links, so it is a section of its own rather than a filter.
  private var starredGroup: LinkGroup? { groups.first { $0.kind == "starred" } }
  private var starredSection: Bool { filter == "starred" || selected?.kind == "starred" }
  @State private var pickingWeek = false
  @State private var readingWeek = Week.monday()
  @State private var listTop: CGFloat = 160
  private var canAdd: Bool { own && !starredSection && (filter == "all" || selected?.kind == "custom") }
  var body: some View {
    GeometryReader { geometry in
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
            LoadingError(error: error, loading: loading, retry: { await load() })
            if let profile {
              profileHeader(profile).padding(.bottom, 32)
              if !own && profile.followedBy.total > 0 {
                Text(socialText(profile.followedBy)).font(IndexFont.sans()).foregroundStyle(IndexPalette.subtleForeground)
                  .padding(.bottom, 28)
              }
              if !profile.canViewContent {
                VStack(spacing: 16) {
                  Divider()
                  Image(systemName: "lock").font(.system(size: 32)).padding(.top, 48)
                  Text("Private profile").font(IndexFont.sans(18, weight: .medium))
                  Text("Only \(profile.name)’s followers can view their posts.")
                    .foregroundStyle(IndexPalette.subtleForeground).multilineTextAlignment(.center)
                  FollowButton(profile: profile)
                }.frame(maxWidth: .infinity)
              } else {
                ForEach(weekIDs, id: \.self) { week in
                  Section {
                    ProfileWeekView(userID: userID, week: week, filter: filter, canAdd: canAdd,
                                    lockedGroups: Set(groups.filter { $0.visibility == .private }.map(\.id)))
                      .id("\(week)-\(filter)").padding(.bottom, 20)
                  } header: {
                    weekHeader(week).background {
                      GeometryReader { position in
                        Color.clear.preference(key: ProfileWeekPositions.self,
                          value: [week: position.frame(in: .named("profile-scroll")).minY])
                      }
                    }
                  }.id(week)
                }
                if weekIDs.isEmpty {
                  HStack { Spacer(); filterMenu }.frame(height: 52)
                  Text(starredSection ? "No starred links yet" : "No links yet")
                    .foregroundStyle(IndexPalette.subtleForeground).frame(maxWidth: .infinity)
                    .padding(.vertical, 60)
                }
                PageEnd(cursor: nextBefore) { try await loadWeeks(more: true) }
                // Let the last heading reach the top when selected from the week picker.
                if let last = weekIDs.last {
                  let rows = weeks.first { $0.weekStart == last }?.count ?? 0
                  Color.clear.frame(height: max(0, geometry.size.height - 52 - CGFloat(rows) * 46
                    - (canAdd && last == Week.monday() ? 48 : 0)))
                }
              }
            }
          }.padding(.top, 40).padding(.leading, 20).padding(.trailing, 36)
        }.coordinateSpace(name: "profile-scroll").scrollIndicators(.hidden)
          .refreshable { await load() }
          .onPreferenceChange(ProfileWeekPositions.self) { positions in
            if let nearest = positions.min(by: { abs($0.value) < abs($1.value) }) { readingWeek = nearest.key }
            listTop = max(52, (positions[weekIDs.first ?? ""] ?? -52) + 52)
          }
          .overlay(alignment: .topTrailing) {
            if profile?.canViewContent == true {
              WeekScrubber(weeks: weekIDs, selected: readingWeek) { week in
                withAnimation { proxy.scrollTo(week, anchor: .top) }
              }.frame(height: max(0, geometry.size.height - listTop - 24), alignment: .top)
                .padding(.top, listTop).padding(.trailing, 4)
            }
          }
          .overlay(alignment: .topTrailing) {
            if profile?.canViewContent == true && !weekIDs.isEmpty {
              filterMenu.frame(maxWidth: 120, alignment: .trailing)
                .padding(.trailing, 36).offset(y: max(0, listTop - 52) + 4)
            }
          }
          .sheet(isPresented: $pickingWeek) {
            WeekPicker(weeks: weekIDs, selected: readingWeek) { week in
              withAnimation { proxy.scrollTo(week, anchor: .top) }
            }
          }
      }
    }.background(IndexPalette.background)
      .task(id: "\(userID)-\(app.revision)") { await load() }
      .sheet(isPresented: $creatingGroup) {
        GroupEditorView { group in
          groups.append(group)
          filter = group.id
        }.indexSheetStyle().presentationDetents([.height(360), .large])
      }
      .task(id: filter) {
        guard profile?.canViewContent == true else { return }
        do { try await loadWeeks() } catch { app.handle(error) }
      }
  }
  private func profileHeader(_ profile: Profile) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      if !app.path.isEmpty { BackButton().padding(.leading, -12) }
      HStack(spacing: 20) {
        PersonAvatar(person: profile.person, size: 64)
        VStack(alignment: .leading, spacing: 10) {
          HStack(spacing: 10) {
            Text(profile.name).font(IndexFont.serif(40, weight: .semibold)).tracking(-0.6)
              .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
            Image(systemName: profile.profileVisibility == .private ? "lock" : "globe")
              .font(.system(size: 16)).foregroundStyle(IndexPalette.subtleForeground)
              .accessibilityLabel(profile.profileVisibility == .private ? "Private profile" : "Public profile")
          }
          ProfileMetaLayout(spacing: 4) {
            if let username = profile.username { Text(username).padding(.trailing, 10) }
            if let count = profile.linkCount { Text("\(count) \(count == 1 ? "link" : "links")").padding(.trailing, 10) }
            if own {
              Button("\(profile.followerCount ?? 0) followers") { app.present(.connections("followers")) }
                .buttonStyle(.plain).padding(.trailing, 10)
              Button("\(profile.followingCount ?? 0) following") { app.present(.connections("following")) }
                .buttonStyle(.plain)
            }
          }.font(IndexFont.sans()).foregroundStyle(IndexPalette.subtleForeground)
        }.frame(maxWidth: .infinity, alignment: .leading)
        if own {
          Button { app.present(.settings) } label: {
            IndexSymbol("NavSettings").frame(width: 25, height: 25).frame(width: 44, height: 44)
          }.buttonStyle(.plain).accessibilityLabel("Settings")
        } else if profile.canViewContent { FollowButton(profile: profile) }
      }
    }
  }
  private func weekHeader(_ week: String) -> some View {
    HStack(spacing: 8) {
      Button { pickingWeek = true } label: {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          Text(Week.label(week)).font(IndexFont.serif(24)).tracking(-0.36)
          Text(weekRange(week).uppercased()).font(IndexFont.mono(12)).tracking(0.72)
            .foregroundStyle(IndexPalette.subtleForeground).lineLimit(1)
        }.frame(minHeight: 52, alignment: .leading)
      }.buttonStyle(.plain).accessibilityLabel("Jump to a week, now \(Week.label(week))")
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: 68)
    }.frame(minHeight: 52).background(IndexPalette.background)
  }
  private var filterMenu: some View {
    Menu {
      Button("All") { filter = "all" }
      ForEach(groups.filter { $0.kind != "starred" }.sorted { $0.kind == "favorites" && $1.kind != "favorites" }) { group in
        Button { filter = group.id } label: {
          Label(group.name, systemImage: group.visibility == .private ? "lock" : group.kind == "favorites" ? "heart" : "folder")
        }
      }
      if own {
        Divider()
        Button("Starred", systemImage: "star") { filter = starredGroup?.id ?? "starred" }
        Divider()
        Button("New group", systemImage: "plus") { creatingGroup = true }
      }
    } label: {
      HStack(spacing: 6) {
        if selected?.visibility == .private { Image(systemName: "lock").font(.system(size: 12)) }
        Text(starredSection ? "Starred" : selected?.name ?? "All").lineLimit(1)
        Image(systemName: "chevron.down").font(.system(size: 12)).foregroundStyle(IndexPalette.subtleForeground)
      }.font(IndexFont.sans(14, weight: .medium)).frame(minHeight: 44)
    }.accessibilityLabel("Showing \(starredSection ? "Starred" : selected?.name ?? "All")")
  }
  private var weekIDs: [String] {
    Array(
      Set(
        weeks.map(\.weekStart)
          + (canAdd ? [Week.monday()] : []))
    ).sorted(by: >)
  }
  private func load() async {
    if profile == nil { profile = await app.api?.cached("/profiles/\(userID)") }
    if groups.isEmpty,
      let cached: Page<LinkGroup> = await app.api?.cached(
        "/groups", query: ["ownerId": userID, "limit": "100"])
    {
      groups = cached.items
    }
    loading = profile == nil
    error = nil
    do {
      let result: Profile? = try await app.api?.request("/profiles/\(userID)")
      try Task.checkCancellation()
      profile = result
      if own { app.profile = result }
      if result?.canViewContent == true {
        async let availableGroups = allGroups(api: app.api, ownerID: userID)
        try await loadWeeks()
        groups = try await availableGroups
        if filter != "all" && filter != "starred" && !groups.contains(where: { $0.id == filter }) {
          filter = "all"
        }
      } else {
        groups = []
        weeks = []
      }
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
  }
  private func loadWeeks(more: Bool = false) async throws {
    let requestedFilter = filter
    // Starred without a group yet has nothing to list.
    if filter == "starred" {
      weeks = []
      nextBefore = nil
      return
    }
    var query = ["limit": "10"]
    if filter != "all" { query["groupId"] = filter }
    if more { query["before"] = nextBefore }
    if !more, weeks.isEmpty,
      let cached: LibraryWeeks = await app.api?.cached("/profiles/\(userID)/weeks", query: query)
    {
      guard requestedFilter == filter else { return }
      weeks = cached.items
      nextBefore = cached.nextBefore
    }
    if let page: LibraryWeeks = try await app.api?.request(
      "/profiles/\(userID)/weeks", query: query)
    {
      try Task.checkCancellation()
      guard requestedFilter == filter else { return }
      weeks = more ? weeks + page.items : page.items
      nextBefore = page.nextBefore
    }
  }
}
struct ProfileWeekView: View {
  let userID: String
  let week: String
  let filter: String
  let canAdd: Bool
  var lockedGroups: Set<String> = []
  @Environment(AppModel.self) private var app
  @State private var links: [SavedLink] = []
  @State private var cursor: String?
  @State private var error: String?
  var body: some View {
    LazyVStack(spacing: 0) {
      if canAdd && week == Week.monday() { QuickAddView(groupID: filter == "all" ? nil : filter) }
      ForEach(links) { link in
        LinkRow(link: link, locked: link.groupId.map { lockedGroups.contains($0) } ?? false)
      }
      LoadingError(error: error, loading: false, retry: { await load() })
      LoadMore(hasMore: cursor != nil) { await load(more: true) }
    }.task(id: app.revision) { await load() }
  }
  private func load(more: Bool = false) async {
    var query = ["weekStart": week, "limit": "30"]
    if more { query["cursor"] = cursor }
    let path: String
    if filter == "all" {
      path = "/profiles/\(userID)/links"
    } else {
      path = "/groups/\(filter)/links"
    }
    if !more, links.isEmpty, let cached: Page<SavedLink> = await app.api?.cached(path, query: query)
    {
      links = cached.items
      cursor = cached.nextCursor
    }
    do {
      if let page: Page<SavedLink> = try await app.api?.request(path, query: query) {
        links = more ? links + page.items : page.items
        cursor = page.nextCursor
        error = nil
      }
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
  }
}
struct FollowButton: View {
  let profile: Profile
  @Environment(AppModel.self) private var app
  var body: some View {
    AsyncButton {
      if profile.followingStatus != nil {
        let _: Success? = try await app.api?.request(
          "/profiles/\(profile.id)/follow", method: "DELETE")
      } else {
        let _: FollowState? = try await app.api?.request(
          "/profiles/\(profile.id)/follow", method: "POST", body: [:])
      }
      app.changed()
    } label: {
      Text(
        profile.followingStatus == "accepted"
          ? "Following"
          : profile.followingStatus == "pending"
            ? "Requested" : profile.profileVisibility == .private ? "Request" : "Follow")
    }.buttonStyle(PillStyle())
  }
}
func socialText(_ context: SocialContext) -> String {
  if context.total > 2 {
    return
      "Followed by \(context.users.first?.label ?? "someone you follow") and \(context.total - 1) others"
  }
  return "Followed by " + context.users.map(\.label).joined(separator: " and ")
}
