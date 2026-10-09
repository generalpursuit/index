import IndexCore
import SwiftUI

struct ProfileView: View {
  let userID: String
  @Environment(AppModel.self) private var app
  @State private var profile: Profile?
  @State private var groups: [LinkGroup] = []
  @State private var filter = "all"
  @State private var weeks: [LibraryWeek] = []
  @State private var nextBefore: String?
  @State private var privacy: IndexCore.Visibility?
  @State private var error: String?
  @State private var loading = true
  var own: Bool { userID == app.userID }
  var selected: LinkGroup? { groups.first { $0.id == filter } }
  // Starred holds other people's links, so it is a section of its own rather than a filter.
  private var starredGroup: LinkGroup? { groups.first { $0.kind == "starred" } }
  private var starredSection: Bool { filter == "starred" || selected?.kind == "starred" }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        LoadingError(error: error, loading: loading, retry: { await load() })
        if let profile {
          HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
              HStack(spacing: 10) {
                Text(profile.username ?? profile.name).font(
                  .system(size: 36, weight: .semibold, design: .serif)
                ).minimumScaleFactor(0.6)
                Image(systemName: profile.profileVisibility == .private ? "lock" : "globe.europe.africa")
                  .font(.system(size: 14)).foregroundStyle(.secondary)
                  .accessibilityLabel(
                    profile.profileVisibility == .private ? "Private profile" : "Public profile")
              }
              Text(profile.name).foregroundStyle(.secondary)
            }
            Spacer()
            PersonAvatar(person: profile.person, size: 64)
          }.padding(.top, 18)
          HStack(spacing: 15) {
            if let count = profile.linkCount { Label("\(count) links", systemImage: "link") }
            if own {
              Button("\(profile.followerCount ?? 0) followers") {
                app.path.append(.connections("followers"))
              }
              Button("\(profile.followingCount ?? 0) following") {
                app.path.append(.connections("following"))
              }
            }
          }.font(.caption)
          if !own && profile.followedBy.total > 0 {
            Text(socialText(profile.followedBy)).font(.caption).foregroundStyle(.secondary)
          }
          if own {
            HStack {
              if let url = app.webURL?.appendingPathComponent("people/\(userID)") {
                ShareLink(item: url) {
                  Label("Share", systemImage: "square.on.square").frame(maxWidth: .infinity)
                }.buttonStyle(PillStyle())
              }
              Menu {
                Button("Public") { if profile.profileVisibility != .public { privacy = .public } }
                Button("Private") {
                  if profile.profileVisibility != .private { privacy = .private }
                }
              } label: {
                Label(profile.profileVisibility.rawValue.capitalized, systemImage: "chevron.down")
                  .font(.caption)
              }.buttonStyle(PillStyle())
              Button {
                app.path.append(.settings)
              } label: {
                Image(systemName: "gearshape").frame(width: 32, height: 44)
              }.accessibilityLabel("Settings")
            }
          } else if profile.canViewContent {
            FollowButton(profile: profile)
          }
          if !profile.canViewContent {
            VStack(spacing: 18) {
              Image(systemName: "lock").font(.largeTitle)
              Text("Private profile").font(.headline)
              Text("Only \(profile.name)’s followers can view their posts.").foregroundStyle(
                .secondary
              ).multilineTextAlignment(.center)
              FollowButton(profile: profile)
            }.frame(maxWidth: .infinity).padding(.vertical, 60)
          } else {
            Divider()
            Picker(
              "Section",
              selection: Binding(
                get: { starredSection },
                set: { starred in filter = starred ? (starredGroup?.id ?? "starred") : "all" })
            ) {
              Text("Links").tag(false)
              Text("Starred").tag(true)
            }.pickerStyle(.segmented)
            if !starredSection {
              ScrollView(.horizontal) {
                HStack(spacing: 8) {
                  filterButton("All", id: "all")
                  ForEach(groups.filter { $0.kind != "starred" }) { group in
                    filterButton(
                      group.name, id: group.id,
                      symbol: group.kind == "favorites"
                        ? "heart" : group.visibility == .private ? "lock" : nil)
                  }
                  if own {
                    Button {
                      app.path.append(.group(nil))
                    } label: {
                      Image(systemName: "plus").frame(width: 38, height: 38)
                    }.accessibilityLabel("Create group")
                  }
                }
              }.scrollIndicators(.hidden)
            }
            if own, let selected {
              HStack {
                AsyncButton {
                  let _: LinkGroup? = try await app.api?.request(
                    "/groups/\(selected.id)", method: "PATCH",
                    body: [
                      "visibility": .string(selected.visibility == .private ? "public" : "private")
                    ])
                  app.changed()
                } label: {
                  Label(
                    selected.visibility == .private ? "Locked" : "Unlocked",
                    systemImage: selected.visibility == .private ? "lock" : "lock.open")
                }
                Spacer()
                if selected.kind == "custom" {
                  Button("Edit group") { app.path.append(.group(selected)) }
                }
              }.font(.caption).foregroundStyle(.secondary)
            }
            ForEach(weekIDs, id: \.self) { week in
              VStack(alignment: .leading, spacing: 10) {
                Text(Week.label(week)).font(.headline)
                ProfileWeekView(
                  userID: userID, week: week, filter: filter,
                  canAdd: own && (selected == nil || selected?.kind == "custom")
                )
                .id("\(week)-\(filter)-\(app.revision)")
              }
            }
            if weekIDs.isEmpty {
              Text("No links yet.").foregroundStyle(.secondary).padding(.vertical, 40)
            }
            LoadMore(hasMore: nextBefore != nil) { try await loadWeeks(more: true) }
          }
        }
      }.padding(.bottom, 30)
    }.indexPage().refreshable { await load() }
      .task(id: "\(userID)-\(app.revision)") { await load() }
      .task(id: filter) {
        guard profile?.canViewContent == true else { return }
        do { try await loadWeeks() } catch { app.handle(error) }
      }
      .alert(
        privacy == .private ? "Make profile private?" : "Make profile public?",
        isPresented: Binding(get: { privacy != nil }, set: { if !$0 { privacy = nil } })
      ) {
        Button("Cancel", role: .cancel) { privacy = nil }
        Button("Confirm") {
          guard let privacy else { return }
          Task {
            do {
              let updated: Profile? = try await app.api?.request(
                "/me/profile", method: "PATCH",
                body: ["profileVisibility": .string(privacy.rawValue)])
              app.profile = updated
              self.privacy = nil
              app.changed()
            } catch { app.handle(error) }
          }
        }
      } message: {
        Text(
          privacy == .private
            ? "Only approved followers can see your links. Existing followers keep access. Locked groups stay only yours."
            : "Anyone can see your links. Pending requests will be accepted. Locked groups stay only yours."
        )
      }
  }
  private var weekIDs: [String] {
    Array(
      Set(
        weeks.map(\.weekStart)
          + (own && (selected == nil || selected?.kind == "custom") ? [Week.monday()] : []))
    ).sorted(by: >)
  }
  private func filterButton(_ title: String, id: String, symbol: String? = nil) -> some View {
    Button {
      filter = id
    } label: {
      HStack(spacing: 5) {
        if let symbol { Image(systemName: symbol) }
        Text(title)
      }
    }.buttonStyle(PillStyle(selected: filter == id))
  }
  private func load() async {
    loading = profile == nil
    error = nil
    do {
      let result: Profile? = try await app.api?.request("/profiles/\(userID)")
      try Task.checkCancellation()
      profile = result
      if own { app.profile = result }
      if result?.canViewContent == true {
        groups = try await allGroups(api: app.api, ownerID: userID)
        if filter != "all" && filter != "starred" && !groups.contains(where: { $0.id == filter }) {
          filter = "all"
        }
        try await loadWeeks()
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
    // Starred without a group yet has nothing to list.
    if filter == "starred" {
      weeks = []
      nextBefore = nil
      return
    }
    var query = ["limit": "10"]
    if filter != "all" { query["groupId"] = filter }
    if more { query["before"] = nextBefore }
    if let page: LibraryWeeks = try await app.api?.request(
      "/profiles/\(userID)/weeks", query: query)
    {
      try Task.checkCancellation()
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
  @Environment(AppModel.self) private var app
  @State private var links: [SavedLink] = []
  @State private var cursor: String?
  @State private var error: String?
  var body: some View {
    VStack(spacing: 0) {
      if canAdd && week == Week.monday() {
        Button {
          app.path.append(.add(week, filter == "all" ? nil : filter, nil))
        } label: {
          Image(systemName: "plus").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }.accessibilityLabel("Add link to \(Week.label(week))")
      }
      ForEach(links) { link in
        LinkRow(link: link)
        if link.id != links.last?.id { Divider() }
      }
      LoadingError(error: error, loading: false, retry: { await load() })
      LoadMore(hasMore: cursor != nil) { await load(more: true) }
    }.outlineCard().task { await load() }
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
