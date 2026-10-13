import Foundation
import IndexCore
import IndexFeatures

@MainActor
extension AppModel {
  var routeOrigins: [URL] {
    let aliases = ProcessInfo.processInfo.environment["INDEX_WEB_ALIASES"]
      ?? Bundle.main.object(forInfoDictionaryKey: "IndexWebAliases") as? String ?? ""
    return [webURL].compactMap { $0 } + aliases.split(separator: ",").compactMap {
      URL(string: $0.trimmingCharacters(in: .whitespacesAndNewlines))
    }
  }
  func openReadableURL(_ url: URL) {
    guard ReadableRouteRequest(url: url, webOrigins: routeOrigins) != nil else { return }
    navigation.pendingRouteURL = url
    navigation.pendingRouteAccountID = profile?.id ?? verificationUser?.id
    resumeReadableURL()
  }
  func resumeReadableURL() {
    guard let url = navigation.pendingRouteURL, verificationUser == nil, profile != nil, !userID.isEmpty else { return }
    navigation.routeTask?.cancel()
    navigation.routeTask = Task { await resolveReadableURL(url) }
  }
  private func resolveReadableURL(_ url: URL) async {
    guard let api, let request = ReadableRouteRequest(url: url, webOrigins: routeOrigins) else { return }
    let account = userID
    do {
      // Restricted sessions can become verified without changing the account ID.
      let session = try await api.restore()
      guard !Task.isCancelled, userID == account else { return }
      guard let session else { handle(APIError.unauthenticated); return }
      guard session.user.emailVerified else { handle(APIError.emailNotVerified); return }
      guard ReadableRouteReadiness.canResolve(userID: session.user.id, emailVerified: session.user.emailVerified),
        session.user.id == account else { return }
      var query = ["path": request.path]
      if let group = request.query["group"] { query["group"] = group }
      let target: RouteResolution = try await api.request("/routes/resolve", query: query)
      guard !Task.isCancelled, userID == account else { return }
      var destinations: [Destination] = []
      switch target.kind {
      case .profile:
        guard let id = target.userId else { return }
        destinations.append(.profile(id))
      case .group:
        guard let id = target.userId, let group = target.groupId else { return }
        destinations.append(.collection(id, group))
      case .link:
        guard let id = target.linkId else { return }
        destinations.append(.link(id))
      case .conversation:
        guard let id = target.conversationId else { return }
        destinations.append(.conversation(id))
      }
      // Search-state references are resolved with fresh account access too.
      for key in ["post", "edit", "attach"] {
        guard let reference = request.query[key] else { continue }
        let prefix = UUID(uuidString: reference) == nil ? "/l/" : "/links/"
        let linked: RouteResolution = try await api.request("/routes/resolve", query: ["path": prefix + reference])
        guard !Task.isCancelled, userID == account, let id = linked.linkId else { return }
        if key == "post" { destinations.append(.link(id)) }
        else {
          let link: SavedLink = try await api.request("/links/\(id)")
          guard !Task.isCancelled, userID == account else { return }
          if key == "edit", link.ownerId == account {
            destinations.append(.edit(link))
          } else if key == "attach", let chat = target.conversationId {
            try drafts.attach(link, to: chat)
          }
        }
      }
      if request.query["settings"] == "true", target.userId == account { destinations.append(.settings) }
      guard !Task.isCancelled, userID == account else { return }
      navigation.openingLink = nil
      navigation.openingConversation = nil
      navigation.sheet = nil
      if let last = destinations.last {
        switch last {
        case .link, .edit, .settings:
          navigation.sheet = destinations.removeLast()
        default: break
        }
      }
      navigation.path = destinations
      if navigation.pendingRouteURL == url { navigation.pendingRouteURL = nil; navigation.pendingRouteAccountID = nil }
    } catch {
      guard !Task.isCancelled, userID == account else { return }
      handle(error)
    }
  }
}
