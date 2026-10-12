import IndexCore
import IndexFeatures
import SwiftUI

private struct DiscoveryFollowButton: View {
  let person: Person
  @Environment(AppModel.self) private var app
  @State private var status: String?
  var body: some View {
    AsyncButton {
      if status != nil {
        let _: Success? = try await app.api?.request("/profiles/\(person.id)/follow", method: "DELETE")
        status = nil
      } else {
        let state: FollowState? = try await app.api?.request("/profiles/\(person.id)/follow", method: "POST", body: [:])
        status = state?.status
      }
      app.changed()
    } label: {
      Text(status == "accepted" ? "Following" : status == "pending" ? "Requested" : person.profileVisibility == .private ? "Request" : "Follow")
        .fixedSize()
    }.buttonStyle(PillStyle()).task(id: person.followingStatus) { status = person.followingStatus }
  }
}

struct DiscoverView: View {
  @Environment(AppModel.self) private var app
  @State private var query = ""
  @State private var people: [Person] = []
  @State private var after: String?
  @State private var loading = false
  @State private var error: String?
  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        PageHeading(title: "Discover").padding(.bottom, 26)
        SearchField(placeholder: "Search people", text: $query).padding(.bottom, 20)
        LoadingError(error: error, loading: loading, retry: { await load() })
        ForEach(people.filter { $0.id != app.userID }) { person in
          HStack {
            Button {
              app.navigate(.profile(person.id))
            } label: {
              PersonRow(person: person)
            }.buttonStyle(.plain)
            if person.profileVisibility == .private {
              Image(systemName: "lock").foregroundStyle(IndexPalette.subtleForeground).font(IndexFont.sans(12))
            }
            DiscoveryFollowButton(person: person)
          }.padding(.vertical, 5)
        }
        if !loading && people.isEmpty && error == nil {
          Text(query.isEmpty ? "Find your people with a search." : "No people found.")
            .foregroundStyle(IndexPalette.subtleForeground).padding(.vertical, 30)
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
  @State private var model = ActivityModel()
  private var items: [Activity] { model.items }
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
        }.scrollIndicators(.hidden).padding(.bottom, 24)
        LoadingError(error: error, loading: loading, retry: { await load() })
        ForEach(items) { activity in
          HStack(alignment: .center, spacing: 10) {
            Button {
              app.navigate(.profile(activity.actor.id))
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
        if !loading && items.isEmpty && error == nil {
          Text("You’re all caught up.").foregroundStyle(IndexPalette.subtleForeground).padding(.vertical, 30)
        }
        LoadMore(hasMore: cursor != nil) { await load(more: true) }
      }
    }.indexPage().refreshable { await load() }
      .task(id: "\(filter)-\(scenePhase)") {
        guard scenePhase == .active else { return }
        await load()
        while !Task.isCancelled {
          do { try await Task.sleep(for: .seconds(30)) } catch { return }
          await load()
        }
      }
  }
  private func resolve(_ activity: Activity, accept: Bool) async throws {
    guard let api = app.api else { return }
    let generation = app.session.generation
    try await model.resolve(activity, accept: accept, api: api)
    guard !Task.isCancelled, generation == app.session.generation else { return }
    app.changed()
    await load()
  }
  private func load(more: Bool = false) async {
    guard let api = app.api else { return }
    do {
      try await model.load(api: api, filter: filter, more: more)
      await app.pollUnread()
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
