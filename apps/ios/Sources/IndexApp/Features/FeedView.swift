import IndexCore
import SwiftUI

struct FeedView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var weeks = [Week.monday(), Week.shift(Week.monday(), by: -1)]
  @State private var visibleWeek: String? = Week.monday()
  @State private var followingCount: Int?

  var body: some View {
    GeometryReader { geometry in
      ScrollView(.vertical) {
        LazyVStack(spacing: 0) {
          ForEach(weeks, id: \.self) { week in
            FeedWeekView(week: week, followingCount: followingCount)
              .padding(.vertical, 40)
              .frame(width: geometry.size.width, height: geometry.size.height)
              .id(week)
              .accessibilityHidden(visibleWeek != week)
          }
        }.scrollTargetLayout()
      }
      .scrollTargetBehavior(.paging)
      .scrollPosition(id: $visibleWeek)
      .scrollIndicators(.hidden)
      .overlay(alignment: .top) {
        Button {
          changeWeek(1)
        } label: {
          Image(systemName: "chevron.up").frame(width: 44, height: 36)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .disabled((visibleWeek ?? Week.monday()) >= Week.monday())
        .accessibilityLabel("Newer week")
      }
      .overlay(alignment: .bottom) {
        Button {
          changeWeek(-1)
        } label: {
          Image(systemName: "chevron.down").frame(width: 44, height: 36)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Older week")
      }
      .onChange(of: visibleWeek) { _, selected in
        // Append below the settled content; existing page identities never move.
        if selected == weeks.last, let selected {
          weeks.append(Week.shift(selected, by: -1))
        }
      }
    }.task(id: app.revision) {
      do {
        let profile: Profile? = try await app.api?.request("/me/profile")
        followingCount = profile?.followingCount
      } catch { if case APIError.unauthenticated = error { app.handle(error) } }
    }
  }
  private func changeWeek(_ direction: Int) {
    let next = Week.shift(visibleWeek ?? Week.monday(), by: direction)
    guard next <= Week.monday() else { return }
    if !weeks.contains(next) { weeks.append(next) }
    withAnimation(reduceMotion ? nil : .snappy) { visibleWeek = next }
  }

}

private struct FeedWeekView: View {
  let week: String
  let followingCount: Int?
  @Environment(AppModel.self) private var app
  @State private var feed: WeekFeed?
  @State private var error: String?
  @State private var loading = false
  var body: some View {
    GeometryReader { geometry in
      VStack(alignment: .leading, spacing: 12) {
        PageHeading(title: Week.label(week))
        LoadingError(error: error, loading: loading, retry: { await load() })
        if let feed {
          if feed.own.items.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
              Text(
                week == Week.monday()
                  ? "What caught your eye this week?" : "No links saved this week."
              )
              .font(.system(size: 30, weight: .medium, design: .serif))
              .fixedSize(horizontal: false, vertical: true)
              Text(
                week == Week.monday()
                  ? "Save something worth coming back to."
                  : "Nothing saved this week."
              )
              .font(.subheadline).foregroundStyle(.secondary)
              // Links are always saved today, so only the current week offers adding.
              if week == Week.monday() {
                Button {
                  app.path.append(.add(week, nil, nil))
                } label: {
                  Label("Add a link", systemImage: "plus")
                }.buttonStyle(PillStyle(selected: true)).padding(.top, 12)
              }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 24)
          } else {
            ScrollView {
              LazyVStack(spacing: 0) {
                if week == Week.monday() {
                  Button {
                    app.path.append(.add(week, nil, nil))
                  } label: {
                    Image(systemName: "plus").frame(
                      maxWidth: .infinity, minHeight: 36, alignment: .leading)
                  }.accessibilityLabel("Add link to \(Week.label(week))")
                }
                ForEach(feed.own.items) { link in
                  LinkRow(link: link, compact: geometry.size.height < 720)
                  Divider()
                }
                LoadMore(hasMore: feed.own.nextCursor != nil) { try await moreOwn() }
              }
            }.frame(height: max(100, geometry.size.height * 0.34))
          }
          if feed.people.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
              Divider().padding(.bottom, 12)
              Text("Your people").font(.caption).foregroundStyle(.secondary)
              Text(
                followingCount == 0
                  ? "Find people whose taste you trust." : "Nothing shared this week yet."
              )
              .font(.subheadline).padding(.top, 6)
              Text("Links from people you follow will appear here.")
                .font(.footnote).foregroundStyle(.secondary)
              if followingCount == 0 {
                Button {
                  app.path = []
                  app.tab = .discover
                } label: {
                  HStack(spacing: 4) {
                    Text("Discover people")
                    Image(systemName: "chevron.right")
                  }
                  .font(.footnote).padding(.top, 6)
                }.buttonStyle(.plain)
              }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
          } else {
            Text("Your people").font(.caption).foregroundStyle(.secondary).padding(.top, 8)
            ScrollView(.horizontal) {
              LazyHStack(alignment: .top, spacing: 16) {
                ForEach(feed.people) { person in
                  VStack(alignment: .leading, spacing: 10) {
                    Button {
                      app.path.append(.profile(person.author.id))
                    } label: {
                      HStack {
                        PersonAvatar(person: person.author, size: 30)
                        Text(person.author.label).font(.subheadline)
                      }
                    }.buttonStyle(.plain)
                    ScrollView {
                      LazyVStack(spacing: 0) {
                        ForEach(person.links.items) { link in
                          LinkRow(link: link, compact: true)
                          if link.id != person.links.items.last?.id { Divider() }
                        }
                        LoadMore(hasMore: person.links.nextCursor != nil) {
                          try await morePerson(person)
                        }
                      }
                    }.outlineCard()
                  }.frame(width: min(340, max(240, geometry.size.width - 48)))
                }
                if feed.nextAfter != nil {
                  AsyncButton(action: morePeople) {
                    Label("More people", systemImage: "chevron.right")
                  }.buttonStyle(PillStyle())
                }
              }
            }.scrollIndicators(.hidden)
          }
        } else {
          Spacer(minLength: 0)
        }
      }.indexPage().padding(.bottom, 12)
    }.task(id: "\(week)-\(app.revision)") { await load() }
  }
  private func load() async {
    loading = feed == nil
    error = nil
    do {
      let result: WeekFeed? = try await app.api?.request(
        "/feed/week", query: ["weekStart": week, "linkLimit": "20"])
      try Task.checkCancellation()
      feed = result
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
  }
  private func moreOwn() async throws {
    guard let cursor = feed?.own.nextCursor else { return }
    let page: Page<SavedLink>? = try await app.api?.request(
      "/links", query: ["weekStart": week, "cursor": cursor])
    if let page { feed?.own = Page<SavedLink>.joined(feed!.own, page) }
  }
  private func morePerson(_ person: PersonLinks) async throws {
    guard let cursor = person.links.nextCursor else { return }
    let page: Page<SavedLink>? = try await app.api?.request(
      "/profiles/\(person.id)/links", query: ["weekStart": week, "cursor": cursor])
    if let page, let index = feed?.people.firstIndex(where: { $0.id == person.id }) {
      feed?.people[index].links = .joined(feed!.people[index].links, page)
    }
  }
  private func morePeople() async throws {
    guard let after = feed?.nextAfter else { return }
    let next: WeekFeed? = try await app.api?.request(
      "/feed/week", query: ["weekStart": week, "after": after])
    if let next, let old = feed { feed = old.appendingPeople(next) }
  }
}
