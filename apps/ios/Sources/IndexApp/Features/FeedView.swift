import IndexCore
import SwiftUI

struct FeedView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var weeks = [Week.monday()]
  @State private var selectedWeek = Week.monday()
  @State private var pickingWeek = false
  @State private var followingCount: Int?
  @State private var weeksError: String?

  var body: some View {
    GeometryReader { geometry in
      let compact = geometry.size.height < 640
      VStack(alignment: .leading, spacing: compact ? 14 : 20) {
        Button { pickingWeek = true } label: {
          Text(Week.label(selectedWeek)).font(IndexFont.serif(compact ? 36 : 44, relativeTo: .largeTitle))
            .tracking(-0.66).frame(maxWidth: .infinity, alignment: .leading)
        }.buttonStyle(.plain).accessibilityAddTraits(.isHeader)
          .accessibilityLabel("\(Week.label(selectedWeek)), jump to a week")
        FeedWeekView(week: selectedWeek, followingCount: followingCount, compact: compact)
          .id(selectedWeek)
      }.padding(.leading, 20).padding(.trailing, 36)
        .padding(.top, compact ? 28 : 40).padding(.bottom, compact ? 20 : 40)
        .overlay(alignment: .topTrailing) {
          WeekScrubber(weeks: weeks, selected: selectedWeek, onSelect: select)
            .padding(.top, compact ? 78 : 104).padding(.bottom, 24).padding(.trailing, 4)
        }
    }.background(IndexPalette.background)
      .sheet(isPresented: $pickingWeek) {
        WeekPicker(weeks: weeks, selected: selectedWeek, onSelect: select)
      }
      .task(id: app.revision) { await loadWeeks() }
      .overlay(alignment: .bottom) {
        if let weeksError {
          Button("Couldn’t load weeks. Retry") { Task { await loadWeeks() } }
            .font(IndexFont.sans(12)).padding(8).background(IndexPalette.background)
            .accessibilityHint(weeksError)
        }
      }
  }
  private func select(_ week: String) {
    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { selectedWeek = week }
  }
  private func loadWeeks() async {
    do {
      async let profile: Profile? = app.api?.request("/me/profile")
      var loaded = [Week.monday()]
      var before: String?
      repeat {
        var query = ["limit": "100"]
        query["before"] = before
        guard let page: LibraryWeeks = try await app.api?.request("/feed/weeks", query: query) else { break }
        try Task.checkCancellation()
        loaded += page.items.map(\.weekStart)
        before = page.nextBefore
      } while before != nil
      weeks = Array(Set(loaded)).sorted(by: >)
      if !weeks.contains(selectedWeek) { weeks.append(selectedWeek); weeks.sort(by: >) }
      let loadedProfile = try await profile
      followingCount = loadedProfile?.followingCount
      weeksError = nil
    } catch is CancellationError {} catch {
      weeksError = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
  }
}

private struct FeedWeekView: View {
  let week: String
  let followingCount: Int?
  let compact: Bool
  @Environment(AppModel.self) private var app
  @State private var feed: WeekFeed?
  @State private var error: String?
  @State private var loading = false
  var body: some View {
    GeometryReader { geometry in
      let gap: CGFloat = compact ? 14 : 20
      let ownHeight = max(100, (geometry.size.height - gap) * (compact ? 0.425 : 0.5))
      VStack(alignment: .leading, spacing: gap) {
        VStack(alignment: .leading, spacing: 0) {
          if week == Week.monday() { QuickAddView() }
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
              LoadingError(error: error, loading: loading, retry: { await load() })
              if let feed {
                ForEach(feed.own.items) { LinkRow(link: $0, compact: compact) }
                PageEnd(cursor: feed.own.nextCursor) { try await moreOwn() }
                if feed.own.items.isEmpty {
                  Text(week == Week.monday() ? "Save something worth coming back to." : "Nothing saved this week.")
                    .font(IndexFont.sans()).foregroundStyle(IndexPalette.subtleForeground)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 16)
                }
              }
            }.padding(.bottom, 24)
          }.scrollIndicators(.hidden).bottomFade()
        }.frame(height: ownHeight).accessibilityElement(children: .contain).accessibilityLabel("Yours")
        if let feed, !feed.people.isEmpty {
          ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 16) {
              ForEach(feed.people) { person in
                personColumn(person).frame(width: max(220, geometry.size.width - 18))
                  .scrollTransition(axis: .horizontal) { content, phase in
                    content.opacity(phase.isIdentity ? 1 : 0.3)
                  }
              }
              PageEnd(cursor: feed.nextAfter) { try await morePeople() }.frame(width: 44)
            }.scrollTargetLayout()
          }.scrollTargetBehavior(.viewAligned).scrollIndicators(.hidden)
            .accessibilityLabel("Your people")
        } else if feed != nil {
          VStack(alignment: .leading, spacing: 12) {
            Text(followingCount == 0 ? "Find your people" : "Nothing shared this week yet.")
              .font(IndexFont.sans(14, weight: .medium))
            Text("Links from people you follow will appear here.")
              .font(IndexFont.sans()).foregroundStyle(IndexPalette.subtleForeground)
            if followingCount == 0 {
              Button { app.path = []; app.tab = .discover } label: {
                Text("Discover people →").font(IndexFont.sans())
              }.buttonStyle(.plain).padding(.top, 4)
            }
            Spacer(minLength: 0)
          }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(IndexPalette.border))
        } else { Spacer(minLength: 0) }
      }
    }.task(id: app.revision) { await load() }
  }
  private func personColumn(_ person: PersonLinks) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Button { app.navigate(.profile(person.id)) } label: {
        HStack(spacing: 12) {
          PersonAvatar(person: person.author, size: 32)
          Text(person.author.label).font(IndexFont.sans(13, weight: .medium)).lineLimit(1)
          Spacer(minLength: 0)
        }.frame(minHeight: 36).contentShape(Rectangle())
      }.buttonStyle(.plain)
      ScrollView {
        LazyVStack(spacing: 0) {
          ForEach(person.links.items) { LinkRow(link: $0, compact: compact) }
          PageEnd(cursor: person.links.nextCursor) { try await morePerson(person) }
        }.padding(.bottom, 24)
      }.scrollIndicators(.hidden).bottomFade()
    }.padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
  }
  private func load() async {
    if feed == nil {
      feed = await app.api?.cached("/feed/week", query: ["weekStart": week, "linkLimit": "20"])
    }
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
