import Foundation
import IndexCore

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
    pendingRouteURL = url
    pendingRouteAccountID = profile?.id ?? verificationUser?.id
    resumeReadableURL()
  }
  func resumeReadableURL() {
    guard let url = pendingRouteURL, verificationUser == nil, profile != nil, !userID.isEmpty else { return }
    routeTask?.cancel()
    routeTask = Task { await resolveReadableURL(url) }
  }
  private func resolveReadableURL(_ url: URL) async {
    guard let api, let request = ReadableRouteRequest(url: url, webOrigins: routeOrigins) else { return }
    let account = userID
    do {
      // Restricted sessions can become verified without changing the account ID.
      let session = try await api.restore()
      guard ReadableRouteReadiness.canResolve(userID: session?.user.id, emailVerified: session?.user.emailVerified == true),
        session?.user.id == account, !Task.isCancelled, userID == account else { return }
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
            destinations.append(.add(Week.monday(Week.date(link.savedOn)), link.groupId, link))
          } else if key == "attach", let chat = target.conversationId {
            var draft = drafts[chat] ?? MessageDraft()
            draft.attachment = link
            draft.clientID = UUID().uuidString
            drafts[chat] = draft
          }
        }
      }
      if request.query["settings"] == "true", target.userId == account { destinations.append(.settings) }
      guard !Task.isCancelled, userID == account else { return }
      openingLink = nil
      openingConversation = nil
      path = destinations
      if pendingRouteURL == url { pendingRouteURL = nil; pendingRouteAccountID = nil }
    } catch {
      guard !Task.isCancelled, userID == account else { return }
      handle(error)
    }
  }
}
