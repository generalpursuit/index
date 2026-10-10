import Foundation
import Observation
import IndexCore

@MainActor @Observable
public final class ShareModel {
  public var draft = ShareDraft()
  public var groups: [LinkGroup] = []
  public var selected: LinkGroup?
  public var destinationUnavailable = false
  public var profile: Profile?
  public var error: String?
  public var inputIssue: String?
  public var restricted: String?
  public var busy = false
  public var extracting = false
  public var result: ShareResult?
  public var existing: SavedLink?
  public var api: APIClient?
  private let server: URL
  private let credentials: ReadOnlyCredentials
  private var operation: Task<Void, Never>?
  private var active = true
  public init(server: URL, accessGroup: String) {
    self.server = server
    credentials = ReadOnlyCredentials(KeychainCredentials(server: server, accessGroup: accessGroup))
  }
  public func connect() async {
    guard !busy else { return }
    busy = true; error = nil
    defer { busy = false }
    do {
      let client = try APIClient(baseURL: server, credentials: credentials, externallyManagedSession: true)
      guard let session = try await client.restore() else { throw APIError.unauthenticated }
      guard session.user.emailVerified else { throw APIError.emailNotVerified }
      let current: Profile = try await client.request("/me/profile")
      var all: [LinkGroup] = [], cursor: String?
      repeat {
        var query = ["ownerId": current.id, "limit": "100"]
        if let cursor { query["cursor"] = cursor }
        let page: Page<LinkGroup> = try await client.request("/groups", query: query)
        all += page.items.filter { $0.kind == "custom" && $0.ownerId == current.id }
        cursor = page.nextCursor
      } while cursor != nil
      try Task.checkCancellation()
      guard active else { return }
      if profile?.id != current.id { selected = nil; draft.groupID = nil; result = nil; existing = nil }
      profile = current; groups = all; api = client; restricted = nil
      let refreshed = ShareDraft.destination(selected, in: all, complete: true)
      selected = refreshed.group; destinationUnavailable = refreshed.unavailable
      if destinationUnavailable { error = "That group is no longer available. Choose a destination." }
    } catch is CancellationError {} catch { handle(error) }
  }
  public func select(_ group: LinkGroup?) { destinationUnavailable = false; selected = group; draft.groupID = group?.id }
  public func created(_ group: LinkGroup) {
    guard active, group.ownerId == profile?.id else { return }
    groups.insert(group, at: 0); select(group)
  }
  public func save(again: Bool = false) {
    guard !busy, !extracting, !destinationUnavailable, let api, let account = profile?.id else { return }
    busy = true; error = nil
    operation = Task { @MainActor in
      defer { busy = false }
      do {
        guard let session = try await api.restore(), session.user.id == account else { throw APIError.unauthenticated }
        guard session.user.emailVerified else { throw APIError.emailNotVerified }
        let body = try draft.body(accountID: account, saveAgain: again)
        let response: ShareResult = try await api.request("/links/share", method: "POST", body: body)
        try Task.checkCancellation()
        guard active, account == profile?.id else { return }
        result = response
      } catch is CancellationError {} catch { handle(error) }
    }
  }
  public func viewExisting() {
    guard !busy, let api, let result else { return }
    busy = true; error = nil
    operation = Task { @MainActor in
      defer { busy = false }
      do {
        let path = result.link.shortId.map(ReadableRoutes.link) ?? "/links/\(result.link.id)"
        let resolution: RouteResolution = try await api.request("/routes/resolve", query: ["path": path])
        guard resolution.kind == .link, let id = resolution.linkId else { throw APIError.invalidResponse }
        let link: SavedLink = try await api.request("/links/\(id)")
        try Task.checkCancellation()
        guard active else { return }
        existing = link
      } catch is CancellationError {} catch { handle(error) }
    }
  }
  public func handle(_ error: Error) {
    guard active else { return }
    switch error {
    case APIError.unauthenticated, APIError.emailNotVerified:
      restricted = error.localizedDescription
      profile = nil; groups = []; selected = nil; draft.groupID = nil; result = nil; existing = nil; api = nil
    default: self.error = error.localizedDescription
    }
  }
  public func cancel() { active = false; operation?.cancel(); operation = nil }
}
