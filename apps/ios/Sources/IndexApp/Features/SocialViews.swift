import IndexCore
import IndexFeatures
import SwiftUI

private struct DiscoveryFollowButton: View {
  let person: Person
  @Environment(AppModel.self) private var app
  @Environment(\.screenVisible) private var visible
  var body: some View {
    AsyncButton {
      try await app.store?.follow(person)
    } label: {
      Text(person.followingStatus == "accepted" ? "Following" : person.followingStatus == "pending" ? "Requested" : person.profileVisibility == .private ? "Request" : "Follow")
        .fixedSize()
    }.buttonStyle(PillStyle())
  }
}

struct DiscoverView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.screenVisible) private var visible
  @State private var query = ""
  @Environment(AccountStore.self) private var store
  private var model: DiscoveryModel { store.discovery }
  private var people: [Person] { !model.hasLoaded && error == nil ? (0..<5).map(ContentPlaceholder.person) : model.people }
  private var after: String? { model.after }
  private var loading: Bool { model.loading }
  private var error: String? { model.error }
  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        PageHeading(title: "Discover").padding(.bottom, 26)
        SearchField(placeholder: "Search people", text: $query).padding(.bottom, 20)
        RequestError(error: error, retry: { await load() })
        Group {
          ForEach(people.filter { $0.id != app.userID }) { person in
            HStack {
              Button {
                app.openProfile(person)
              } label: {
                PersonRow(person: person)
              }.buttonStyle(.plain)
              if person.profileVisibility == .private {
                Image(systemName: "lock").foregroundStyle(IndexPalette.subtleForeground).font(IndexFont.sans(12))
              }
              DiscoveryFollowButton(person: person)
            }.padding(.vertical, 5)
          }
        }.calmPlaceholder(active: !model.hasLoaded && error == nil)
        if model.hasLoaded && !loading && people.isEmpty && error == nil {
          Text(query.isEmpty ? "Find your people with a search." : "No people found.")
            .foregroundStyle(IndexPalette.subtleForeground).padding(.vertical, 30)
        }
        LoadMore(hasMore: after != nil) { await load(more: true) }
      }
    }.indexPage().scrollDismissesKeyboard(.interactively)
      .onChange(of: query, initial: true) { _, query in store.discoveryQuery = query }
      .onDisappear { store.discoveryQuery = nil }
      .task(id: "\(query)-\(visible)") {
        guard visible else { return }
        do {
          if !query.isEmpty { try await Task.sleep(for: .milliseconds(250)) }
          await load()
        } catch {}
      }
  }
  private func load(more: Bool = false) async {
    do {
      try await store.refreshDiscovery(query, more: more)
    } catch { app.handleSessionError(error) }
  }
}
struct ActivityView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.screenVisible) private var visible
  @Environment(\.scenePhase) private var scenePhase
  @State private var filter = "all"
  @Environment(AccountStore.self) private var store
  private var model: ActivityModel { store.activity(filter) }
  private var items: [Activity] { !model.hasLoaded && error == nil ? (0..<5).map(ContentPlaceholder.activity) : model.items }
  private var cursor: String? { model.cursor }
  private var error: String? { model.error }
  private var loading: Bool { model.loading }
  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        PageHeading(title: "Activity").padding(.bottom, 26)
        ScrollView(.horizontal) {
          HStack(spacing: 8) {
            ForEach(
              [
                ("all", "All"), ("comment", "Comments"), ("request", "Requests"),
                ("mention", "Mentions"), ("follow", "Follows"),
              ], id: \.0
            ) { item in
              Button(item.1) { filter = item.0 }.buttonStyle(PillStyle(selected: filter == item.0, compact: true))
            }
          }
        }.padding(.bottom, 24)
        RequestError(error: error, retry: { await load() })
        Group {
          ForEach(items) { activity in
            HStack(alignment: .center, spacing: 10) {
              Button {
                app.openProfile(activity.actor)
              } label: {
                PersonAvatar(person: activity.actor, size: 34)
              }.buttonStyle(.plain)
              VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                  Text(activity.actor.label).font(IndexFont.sans(12)).bold()
                  Text(relativeTime(activity.createdAt)).font(IndexFont.sans(11)).foregroundStyle(IndexPalette.subtleForeground)
                }
                Text(activityText(activity)).font(IndexFont.sans(12))
              }.frame(maxWidth: .infinity, alignment: .leading)
              if activity.type == "request" && activity.requestStatus == "pending" {
                HStack(spacing: 5) {
                  AsyncButton {
                    try await resolve(activity, accept: true)
                  } label: {
                    Text("Accept").font(IndexFont.sans(11))
                  }.buttonStyle(PillStyle(selected: true))
                  AsyncButton {
                    try await resolve(activity, accept: false)
                  } label: {
                    Text("Decline")
                  }.buttonStyle(PillStyle()).accessibilityLabel(
                    "Decline \(activity.actor.name)’s request")
                }
              } else if let id = activity.linkId {
                Button {
                  app.present(.link(id))
                } label: {
                  Image(systemName: "chevron.right").frame(width: 32, height: 44)
                }.accessibilityLabel("Open post")
              }
            }.padding(.vertical, 14)
          }
        }.calmPlaceholder(active: !model.hasLoaded && error == nil)
        if model.hasLoaded && !loading && items.isEmpty && error == nil {
          Text("You’re all caught up.").foregroundStyle(IndexPalette.subtleForeground).padding(.vertical, 30)
        }
        LoadMore(hasMore: cursor != nil) { await load(more: true) }
      }
    }.indexPage().refreshable { await load(force: true) }
      .onChange(of: visible, initial: true) { _, visible in store.activityFilter = visible ? filter : nil }
      .onDisappear { if store.activityFilter == filter { store.activityFilter = nil } }
      .task(id: "\(filter)-\(scenePhase)-\(visible)") {
        if visible { store.activityFilter = filter }
        guard visible, scenePhase == .active else { return }
        await load()
      }
  }
  private func resolve(_ activity: Activity, accept: Bool) async throws {
    try await store.resolve(activity, accept: accept)
  }
  private func load(more: Bool = false, force: Bool = false) async {
    do {
      try await store.refreshActivity(filter, more: more, force: force)
    } catch { app.handleSessionError(error) }
  }
}
func activityText(_ activity: Activity) -> String {
  switch activity.type {
  case "mention": "mentioned you: \(activity.body ?? "")"
  case "comment": activity.body ?? "commented on your link."
  case "follow": "started following you."
  case "accepted": "accepted your follow request."
  default:
    activity.requestStatus == "pending"
      ? "requested to follow you." : "Follow request \(activity.requestStatus ?? "updated")."
  }
}
