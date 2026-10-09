import IndexCore
import SwiftUI

struct DiscoverView: View {
  @Environment(AppModel.self) private var app
  @State private var query = ""
  @State private var people: [Person] = []
  @State private var after: String?
  @State private var loading = false
  @State private var error: String?
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        PageHeading(title: "Discover", messages: true)
        TextField("Search people", text: $query).padding(14).background(
          .white.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        LoadingError(error: error, loading: loading, retry: { await load() })
        ForEach(people) { person in
          HStack {
            Button {
              app.path.append(.profile(person.id))
            } label: {
              PersonRow(person: person)
            }.buttonStyle(.plain)
            if person.profileVisibility == .private {
              Image(systemName: "lock").foregroundStyle(.secondary).font(.caption)
            }
            Image(systemName: "chevron.right").foregroundStyle(.secondary)
          }
        }
        if !loading && people.isEmpty && error == nil {
          Text(query.isEmpty ? "Find your people with a search." : "No people found.")
            .foregroundStyle(.secondary).padding(.vertical, 30)
        }
        LoadMore(hasMore: after != nil) { await load(more: true) }
      }
    }.indexPage().scrollDismissesKeyboard(.interactively)
      .task(id: query) {
        do {
          if !query.isEmpty { try await Task.sleep(for: .milliseconds(250)) }
          await load()
        } catch {}
      }
  }
  private func load(more: Bool = false) async {
    loading = true
    error = nil
    do {
      if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        if people.isEmpty,
          let cached: Recommendations = await app.api?.cached("/discovery/recommendations")
        {
          people = cached.items
          loading = false
        }
        let page: Recommendations? = try await app.api?.request("/discovery/recommendations")
        people = page?.items ?? []
        after = nil
      } else {
        var params = ["query": query, "limit": "30"]
        if more { params["after"] = after }
        if let page: PeoplePage = try await app.api?.request("/discovery/users", query: params) {
          people = more ? people + page.items : page.items
          after = page.nextAfter
        }
      }
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
  }
}
struct ActivityView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @State private var filter = "all"
  @State private var items: [Activity] = []
  @State private var cursor: String?
  @State private var error: String?
  @State private var loading = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        PageHeading(title: "Activity")
        ScrollView(.horizontal) {
          HStack {
            ForEach(
              [
                ("all", "All"), ("comment", "Comments"), ("request", "Requests"),
                ("mention", "Mentions"), ("follow", "Follows"),
              ], id: \.0
            ) { item in
              Button(item.1) { filter = item.0 }.buttonStyle(PillStyle(selected: filter == item.0))
            }
          }
        }.scrollIndicators(.hidden)
        LoadingError(error: error, loading: loading, retry: { await load() })
        ForEach(items) { activity in
          HStack(alignment: .center, spacing: 10) {
            Button {
              app.path.append(.profile(activity.actor.id))
            } label: {
              PersonAvatar(person: activity.actor, size: 34)
            }.buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 5) {
              HStack(spacing: 6) {
                Text(activity.actor.label).font(.caption).bold()
                Text(relativeTime(activity.createdAt)).font(.caption2).foregroundStyle(.secondary)
              }
              Text(activityText(activity)).font(.caption).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading)
            if activity.type == "request" && activity.requestStatus == "pending" {
              HStack(spacing: 5) {
                AsyncButton {
                  try await resolve(activity, accept: true)
                } label: {
                  Text("Accept").font(.caption2)
                }.buttonStyle(PillStyle(selected: true))
                AsyncButton {
                  try await resolve(activity, accept: false)
                } label: {
                  Image(systemName: "xmark").font(.caption)
                }.buttonStyle(PillStyle()).accessibilityLabel(
                  "Decline \(activity.actor.name)’s request")
              }
            } else if let id = activity.linkId {
              Button {
                app.path.append(.link(id))
              } label: {
                Image(systemName: "chevron.right").frame(width: 32, height: 44)
              }.accessibilityLabel("Open post")
            }
          }.padding(.vertical, 7)
        }
        if !loading && items.isEmpty && error == nil {
          Text("You’re all caught up.").foregroundStyle(.secondary).padding(.vertical, 30)
        }
        LoadMore(hasMore: cursor != nil) { await load(more: true) }
      }
    }.indexPage().refreshable { await load() }
      .task(id: "\(filter)-\(app.revision)-\(scenePhase)") {
        guard scenePhase == .active else { return }
        await load()
        while !Task.isCancelled {
          do { try await Task.sleep(for: .seconds(30)) } catch { return }
          await load()
        }
      }
  }
  private func resolve(_ activity: Activity, accept: Bool) async throws {
    if accept {
      let _: FollowState? = try await app.api?.request(
        "/me/follow-requests/\(activity.actor.id)/accept", method: "POST", body: [:])
    } else {
      let _: Success? = try await app.api?.request(
        "/me/follow-requests/\(activity.actor.id)", method: "DELETE")
    }
    app.changed()
  }
  private func load(more: Bool = false) async {
    loading = items.isEmpty
    error = nil
    var query = ["limit": "30"]
    if filter != "all" { query["type"] = filter }
    if more { query["cursor"] = cursor }
    if !more, items.isEmpty,
      let cached: ActivityPage = await app.api?.cached("/me/activity", query: query)
    {
      items = cached.items
      cursor = cached.nextCursor
      loading = false
    }
    do {
      if let page: ActivityPage = try await app.api?.request("/me/activity", query: query) {
        items = more ? items + page.items : page.items
        cursor = page.nextCursor
        app.unreadActivity = page.unreadCount
        let ids = page.items.filter { $0.readAt == nil }.map(\.id)
        if !ids.isEmpty && scenePhase == .active {
          let _: Success? = try await app.api?.request(
            "/me/activity/read", method: "POST", body: ["ids": .strings(ids)])
          await app.pollUnread()
        }
      }
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
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
