import Foundation
import SafariServices
import IndexCore

@objc(SafariWebExtensionHandler)
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
  func beginRequest(with context: NSExtensionContext) {
    let item = context.inputItems.first as? NSExtensionItem
    let message = item?.userInfo?[SFExtensionMessageKey] as? [String: String]
    let completion = SafariReply(context)
    Task {
      let reply: [String: Any]
      do {
        guard let message else { throw APIError.invalidResponse }
        reply = try await Self.handle(message)
      } catch APIError.unauthenticated {
        reply = ["error": "Open Index to sign in, then reopen this menu.", "reset": true]
      } catch APIError.emailNotVerified {
        reply = ["error": "Verify your email in Index, then reopen this menu.", "reset": true]
      } catch APIError.server(let status, let message) where [403, 404, 409].contains(status) {
        reply = ["error": message, "chooseAgain": true]
      } catch {
        reply = ["error": error.localizedDescription]
      }
      completion.send(reply)
    }
  }

  private static func handle(_ message: [String: String]) async throws -> [String: Any] {
    guard let raw = Bundle.main.object(forInfoDictionaryKey: "IndexAPIURL") as? String,
      let server = URL(string: try APIScope.normalize(raw)),
      let group = Bundle.main.object(forInfoDictionaryKey: "IndexKeychainGroup") as? String,
      !group.isEmpty, !group.contains("$(") else { throw APIError.invalidServer }
    let credentials = ReadOnlyCredentials(KeychainCredentials(server: server, accessGroup: group))
    let api = try APIClient(baseURL: server, credentials: credentials, externallyManagedSession: true)
    guard let session = try await api.restore() else { throw APIError.unauthenticated }
    guard session.user.emailVerified else { throw APIError.emailNotVerified }
    guard let sessionID = session.session?.id else { throw APIError.invalidResponse }

    switch message["action"] {
    case "destinations":
      let groups = try await api.shareDestinations(ownerID: session.user.id)
      return ["account": session.user.id, "session": sessionID,
              "groups": groups.map { ["id": $0.id, "name": $0.name] }]
    case "save":
      // Safari can start a fresh native process for each message from the same popup.
      guard message["account"] == session.user.id, message["session"] == sessionID else {
        return ["error": "Your Index session changed. Reload to choose a destination.", "reset": true]
      }
      guard let url = message["url"], let groupID = message["groupID"],
        groupID.isEmpty || UUID(uuidString: groupID) != nil,
        let rawID = message["requestID"], let id = UUID(uuidString: rawID),
        let flag = message["saveAgain"], let again = Bool(flag) else { throw APIError.invalidResponse }
      let body = try ShareDraft.body(url: url, groupID: groupID.isEmpty ? nil : groupID, requestID: id, saveAgain: again)
      let result: ShareResult = try await api.request("/links/share", method: "POST", body: body)
      return ["status": result.status]
    default:
      throw APIError.invalidResponse
    }
  }
}

/// Each request hands its context to exactly one task, which uses it only to deliver the reply.
private final class SafariReply: @unchecked Sendable {
  private let context: NSExtensionContext
  init(_ context: NSExtensionContext) { self.context = context }

  func send(_ reply: [String: Any]) {
    let result = NSExtensionItem()
    result.userInfo = [SFExtensionMessageKey: reply]
    context.completeRequest(returningItems: [result], completionHandler: nil)
  }
}
