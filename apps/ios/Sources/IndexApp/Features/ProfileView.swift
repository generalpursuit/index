import IndexCore
import IndexFeatures
import SwiftUI

struct ProfileView: View {
  let userID: String
  init(userID: String, groupID: String? = nil) {
    self.userID = userID
    _filter = State(initialValue: groupID ?? "all")
  }
  @Environment(AppModel.self) private var app
  @State private var model = ProfileModel()
  private var profile: Profile? { model.profile }
  private var groups: [LinkGroup] { model.groups }
  @State private var creatingGroup = false
  @State private var filter = "all"
  private var weeks: [LibraryWeek] { model.weeks }
  private var nextBefore: String? { model.nextBefore }
  private var error: String? { model.error }
  private var loading: Bool { model.loading }
  var own: Bool { userID == app.userID }
  var selected: LinkGroup? { groups.first { $0.id == filter } }
  // Starred holds other people's links, so it is a section of its own rather than a filter.
  private var starredGroup: LinkGroup? { groups.first { $0.kind == "starred" } }
  private var starredSection: Bool { filter == "starred" || selected?.kind == "starred" }
  @State private var pickingWeek = false
  @State private var readingWeek = Week.monday()
  private var canAdd: Bool { own && !starredSection && (filter == "all" || selected?.kind == "custom") }
  var body: some View {
    GeometryReader { geometry in
      let height = geometry.size.height
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
            LoadingError(error: error, loading: loading, retry: { await load() })
            if let profile {
              profileHeader(profile).padding(.top, 40).padding(.bottom, 32)
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
                  Text(starredSection ? "No starred links yet" : "No links yet")
                    .foregroundStyle(IndexPalette.subtleForeground).frame(maxWidth: .infinity)
                    .padding(.vertical, 60)
                }
                PageEnd(cursor: nextBefore) { try await loadWeeks(more: true) }
                // Let the last heading reach the top when selected from the week picker.
                if let last = weekIDs.last {
                  let rows = weeks.first { $0.weekStart == last }?.count ?? 0
                  Color.clear.frame(height: max(0, height - 52 - CGFloat(rows) * 46
                    - (canAdd && last == Week.monday() ? 48 : 0)))
                }
              }
            }
          }.padding(.leading, 20).padding(.trailing, 36).padding(.bottom, 68)
        }.coordinateSpace(name: "profile-scroll").scrollIndicators(.hidden)
          .frame(width: geometry.size.width, height: height, alignment: .top).clipped()
          .refreshable { await load() }
          .onPreferenceChange(ProfileWeekPositions.self) { positions in
            if let nearest = positions.min(by: { abs($0.value) < abs($1.value) }) { readingWeek = nearest.key }
          }
          .overlay(alignment: .trailing) {
            if profile?.canViewContent == true {
              WeekScrubber(weeks: weekIDs, selected: readingWeek) { week in
                withAnimation { proxy.scrollTo(week, anchor: .top) }
              }.frame(height: min(height * 0.6, CGFloat(weekIDs.count) * 12))
                .padding(.trailing, 4)
            }
          }
          .sheet(isPresented: $pickingWeek) {
            WeekPicker(weeks: weekIDs, selected: readingWeek) { week in
              withAnimation { proxy.scrollTo(week, anchor: .top) }
            }
          }
          .overlay(alignment: .bottom) {
            if profile?.canViewContent == true && (own || !groups.isEmpty) {
              listDock.padding(.horizontal, 16).padding(.bottom, 12)
            }
          }
      }
    }.clipped().background(IndexPalette.background)
      .task(id: "\(userID)-\(app.revision)") { await load() }
      .sheet(isPresented: $creatingGroup) {
        GroupEditorView { group in
          model.created(group)
          filter = group.id
        }.indexSheetStyle().presentationDetents([.height(360), .large])
      }
      .task(id: filter) {
        do { try await loadWeeks() } catch { app.handle(error) }
      }
  }
  private func profileHeader(_ profile: Profile) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      if !app.navigation.path.isEmpty { BackButton().padding(.leading, -12) }
      HStack(spacing: 20) {
        PersonAvatar(person: profile.person, size: 64)
        VStack(alignment: .leading, spacing: 10) {
          HStack(spacing: 10) {
            Text(profile.name).font(IndexFont.serif(40, weight: .semibold)).tracking(-0.6)
              .lineLimit(1).minimumScaleFactor(0.01).accessibilityAddTraits(.isHeader)
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
      Spacer(minLength: 0)
    }.frame(minHeight: 52).background(IndexPalette.background)
  }
  private var listDock: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal) {
        HStack(spacing: 2) {
          listChip("All", id: "all")
          ForEach(groups.filter { $0.kind != "starred" }.sorted { $0.kind == "favorites" && $1.kind != "favorites" }) { group in
            listChip(group.name, id: group.id, locked: group.visibility == .private)
          }
          if own {
            listChip("Starred", id: starredGroup?.id ?? "starred")
            Button { creatingGroup = true } label: {
              Image(systemName: "plus").font(.system(size: 16)).foregroundStyle(IndexPalette.subtleForeground)
                .frame(width: 32, height: 32)
            }.buttonStyle(.plain).accessibilityLabel("New group")
          }
        }.padding(6)
      }.scrollIndicators(.hidden).fixedSize(horizontal: false, vertical: true)
        .background(IndexPalette.card, in: Capsule())
        .clipShape(Capsule())
        .overlay(Capsule().stroke(IndexPalette.foreground.opacity(0.08), lineWidth: 1))
        .shadow(color: .black.opacity(0.1), radius: 3, y: 1)
        .accessibilityElement(children: .contain).accessibilityLabel("Lists")
        .onChange(of: filter, initial: true) { _, value in proxy.scrollTo(value, anchor: .center) }
    }
  }
  private func listChip(_ title: String, id: String, locked: Bool = false) -> some View {
    Button { filter = id } label: {
      HStack(spacing: 4) {
        Text(title).font(IndexFont.sans(13)).lineLimit(1)
        if locked { Image(systemName: "lock").font(.system(size: 12)).foregroundStyle(IndexPalette.subtleForeground) }
      }.padding(.horizontal, 14).frame(height: 32)
        .background(filter == id ? IndexPalette.muted : .clear, in: Capsule())
    }.buttonStyle(.plain).id(id)
      .accessibilityLabel(locked ? "\(title), only you" : title)
      .accessibilityAddTraits(filter == id ? .isSelected : [])
  }
  private var weekIDs: [String] {
    Array(
      Set(
        weeks.map(\.weekStart)
          + (canAdd ? [Week.monday()] : []))
    ).sorted(by: >)
  }
  private func load() async {
    guard let api = app.api else { return }
    let generation = app.session.generation
    do {
      let applied = try await model.load(api: api, userID: userID, filter: filter)
      guard applied, !Task.isCancelled, generation == app.session.generation else { return }
      if own { app.profile = model.profile }
      if filter != "all" && filter != "starred" && !groups.contains(where: { $0.id == filter }) {
        filter = "all"
      }
    } catch { app.handleSessionError(error) }
  }
  private func loadWeeks(more: Bool = false) async throws {
    guard let api = app.api else { return }
    try await model.loadWeeks(api: api, userID: userID, filter: filter, more: more)
  }
}
struct ProfileWeekView: View {
  let userID: String
  let week: String
  let filter: String
  let canAdd: Bool
  var lockedGroups: Set<String> = []
  @Environment(AppModel.self) private var app
  @State private var model = ProfileWeekModel()
  private var links: [SavedLink] { model.links }
  private var cursor: String? { model.cursor }
  private var error: String? { model.error }
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
    guard let api = app.api else { return }
    do { try await model.load(api: api, userID: userID, week: week, filter: filter, more: more) }
    catch { app.handleSessionError(error) }
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
