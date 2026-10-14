import IndexCore
import IndexFeatures
import SwiftUI

struct FeedView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var model = FeedWeeksModel()
  private var weeks: [String] { model.weeks }
  @State private var selectedWeek = Week.monday()
  @State private var pickingWeek = false
  private var followingCount: Int? { model.followingCount }
  private var weeksError: String? { model.error }

  var body: some View {
    GeometryReader { geometry in
      let height = geometry.size.height
      let compact = height < 640
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
        .frame(width: geometry.size.width, height: height, alignment: .topLeading)
        .overlay(alignment: .trailing) {
          WeekScrubber(weeks: weeks, selected: selectedWeek, onSelect: select)
            .frame(height: min(height * 0.6, CGFloat(weeks.count) * 12))
            .padding(.trailing, 4)
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
    guard let api = app.api else { return }
    do { try await model.load(api: api, selectedWeek: selectedWeek) }
    catch { app.handleSessionError(error) }
  }
}

private struct FeedWeekView: View {
  let week: String
  let followingCount: Int?
  let compact: Bool
  @Environment(AppModel.self) private var app
  @State private var model = FeedWeekModel()
  private var feed: WeekFeed? { model.feed }
  private var error: String? { model.error }
  private var loading: Bool { model.loading }
  var body: some View {
    GeometryReader { geometry in
      let gap: CGFloat = compact ? 14 : 20
      let ownHeight = max(100, (geometry.size.height - gap) * (compact ? 0.425 : 0.5))
      let peopleHeight = max(0, geometry.size.height - gap - ownHeight)
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
            .frame(height: peopleHeight)
            .accessibilityLabel("Your people")
        } else if feed != nil {
          ScrollView {
            VStack(spacing: 12) {
              Text(followingCount == 0 ? "Find people whose taste you trust" : week == Week.monday()
                ? "Nothing shared this week yet" : "Nothing shared this week")
                .font(IndexFont.sans()).foregroundStyle(IndexPalette.subtleForeground)
              if followingCount == 0 {
                Button { app.navigation.path = []; app.navigation.tab = .discover } label: {
                  Text("Discover").font(IndexFont.sans())
                }.buttonStyle(.plain)
              }
            }.multilineTextAlignment(.center).padding(24)
              .frame(maxWidth: .infinity, minHeight: peopleHeight)
          }.scrollIndicators(.hidden).frame(height: peopleHeight)
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(IndexPalette.border))
        } else { Spacer(minLength: 0) }
      }.frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
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
    guard let api = app.api else { return }
    do { try await model.load(api: api, week: week) }
    catch { app.handleSessionError(error) }
  }
  private func moreOwn() async throws {
    guard let api = app.api else { return }
    try await model.moreOwn(api: api, week: week)
  }
  private func morePerson(_ person: PersonLinks) async throws {
    guard let api = app.api else { return }
    try await model.morePerson(person.id, api: api, week: week)
  }
  private func morePeople() async throws {
    guard let api = app.api else { return }
    try await model.morePeople(api: api, week: week)
  }
}
