import Foundation
import IndexCore
import Observation

@MainActor @Observable
public final class FeedWeeksModel {
  public private(set) var weeks = [Week.monday()]
  public private(set) var followingCount: Int?
  public private(set) var error: String?
  private var generation = 0
  public init() {}
  public func load(api: any FeatureAPI, selectedWeek: String) async throws {
    generation += 1
    let version = generation
    do {
      async let profile: Profile = api.get("/me/profile")
      var loaded = [Week.monday(), selectedWeek]
      var before: String?
      var visited = Set<String>()
      repeat {
        if let before, !visited.insert(before).inserted { throw APIError.invalidResponse }
        var query = ["limit": "100"]
        query["before"] = before
        let page: LibraryWeeks = try await api.get("/feed/weeks", query: query)
        try Task.checkCancellation()
        guard version == generation else { return }
        loaded += page.items.map(\.weekStart)
        before = page.nextBefore
      } while before != nil
      let result = try await profile
      try Task.checkCancellation()
      guard version == generation else { return }
      weeks = Array(Set(loaded)).sorted(by: >)
      followingCount = result.followingCount
      error = nil
    } catch {
      guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if removesDisplayedContent(error) { weeks = [Week.monday()]; followingCount = nil }
      self.error = error.localizedDescription
      throw error
    }
  }
}

@MainActor @Observable
public final class FeedWeekModel {
  public private(set) var feed: WeekFeed?
  public private(set) var error: String?
  public private(set) var loading = false
  private var busy = false
  private var generation = 0
  private var ownPageCount = 1
  private var peoplePageCount = 1
  private var personPageCounts: [String: Int] = [:]
  public init() {}

  public func load(api: any FeatureAPI, week: String) async throws {
    try Task.checkCancellation()
    generation += 1
    let version = generation
    busy = true
    loading = feed == nil
    error = nil
    defer { if version == generation { busy = false; loading = false } }
    do {
      if feed == nil {
        let snapshot: WeekFeed? = await api.cached("/feed/week", query: ["weekStart": week, "linkLimit": "20"])
        try Task.checkCancellation()
        guard version == generation else { return }
        feed = snapshot
      }
      var result: WeekFeed = try await api.get("/feed/week", query: ["weekStart": week, "linkLimit": "20"])
      for _ in 1..<peoplePageCount {
        guard let after = result.nextAfter else { break }
        let next: WeekFeed = try await api.get("/feed/week", query: ["weekStart": week, "after": after, "linkLimit": "20"])
        try Task.checkCancellation()
        guard version == generation else { return }
        result = result.appendingPeople(next)
      }
      for _ in 1..<ownPageCount {
        guard let cursor = result.own.nextCursor else { break }
        let next: Page<SavedLink> = try await api.get("/links", query: ["weekStart": week, "cursor": cursor])
        try Task.checkCancellation()
        guard version == generation else { return }
        result.own = .joined(result.own, next)
      }
      for index in result.people.indices {
        let person = result.people[index]
        for _ in 1..<(personPageCounts[person.id] ?? 1) {
          guard let cursor = result.people[index].links.nextCursor else { break }
          let next: Page<SavedLink> = try await api.get("/profiles/\(person.id)/links", query: ["weekStart": week, "cursor": cursor])
          try Task.checkCancellation()
          guard version == generation else { return }
          result.people[index].links = .joined(result.people[index].links, next)
        }
        result.people[index].links.items = unique(result.people[index].links.items)
      }
      try Task.checkCancellation()
      guard version == generation else { return }
      result.own.items = unique(result.own.items)
      result.people = unique(result.people)
      feed = result
    } catch { try failed(error, version: version) }
  }

  public func moreOwn(api: any FeatureAPI, week: String) async throws {
    guard !busy, let cursor = feed?.own.nextCursor else { return }
    busy = true
    let version = generation
    defer { if version == generation { busy = false } }
    do {
      let page: Page<SavedLink> = try await api.get("/links", query: ["weekStart": week, "cursor": cursor])
      try Task.checkCancellation()
      guard version == generation, var result = feed else { return }
      result.own = .joined(result.own, page)
      result.own.items = unique(result.own.items)
      feed = result
      ownPageCount += 1
      error = nil
    } catch { try failed(error, version: version) }
  }
  public func morePerson(_ id: String, api: any FeatureAPI, week: String) async throws {
    guard !busy, let person = feed?.people.first(where: { $0.id == id }), let cursor = person.links.nextCursor else { return }
    busy = true
    let version = generation
    defer { if version == generation { busy = false } }
    do {
      let page: Page<SavedLink> = try await api.get("/profiles/\(id)/links", query: ["weekStart": week, "cursor": cursor])
      try Task.checkCancellation()
      guard version == generation, var result = feed, let index = result.people.firstIndex(where: { $0.id == id }) else { return }
      result.people[index].links = .joined(result.people[index].links, page)
      result.people[index].links.items = unique(result.people[index].links.items)
      feed = result
      personPageCounts[id, default: 1] += 1
      error = nil
    } catch { try failed(error, version: version) }
  }
  public func morePeople(api: any FeatureAPI, week: String) async throws {
    guard !busy, let after = feed?.nextAfter else { return }
    busy = true
    let version = generation
    defer { if version == generation { busy = false } }
    do {
      let next: WeekFeed = try await api.get("/feed/week", query: ["weekStart": week, "after": after, "linkLimit": "20"])
      try Task.checkCancellation()
      guard version == generation, let old = feed else { return }
      var result = old.appendingPeople(next)
      result.people = unique(result.people)
      feed = result
      peoplePageCount += 1
      error = nil
    } catch { try failed(error, version: version) }
  }
  private func failed(_ error: Error, version: Int) throws {
    guard version == generation, !Task.isCancelled, !(error is CancellationError) else { return }
    if removesDisplayedContent(error) { feed = nil; ownPageCount = 1; peoplePageCount = 1; personPageCounts = [:] }
    self.error = error.localizedDescription
    throw error
  }
}
