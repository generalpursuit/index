import Foundation

/// Relative canonical paths; the configured web origin remains a deployment choice.
public enum ReadableRoutes {
  private static func segment(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")) ?? ""
  }
  public static func profile(_ username: String) -> String { "/u/\(segment(username))" }
  public static func group(_ username: String, _ slug: String) -> String { "\(profile(username))/\(segment(slug))" }
  public static func link(_ shortID: String) -> String { "/l/\(segment(shortID))" }
  public static func conversation(_ shortID: String) -> String { "/messages/\(segment(shortID))" }
}

public struct RouteResolution: Decodable, Sendable {
  public enum Kind: String, Decodable, Sendable { case profile, group, link, conversation }
  public let kind: Kind
  public let canonicalPath: String
  public let userId: String?
  public let groupId: String?
  public let linkId: String?
  public let conversationId: String?
}

public struct ReadableRouteRequest: Equatable, Sendable {
  public let path: String
  public let query: [String: String]
  /// Accept only our scheme or explicitly configured HTTP(S) origins, never arbitrary websites.
  public init?(url: URL, webOrigins: [URL]) {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.user == nil, components.password == nil else { return nil }
    let path: String
    if components.scheme?.lowercased() == "index" {
      guard components.port == nil, let root = components.host else { return nil }
      path = "/" + root + components.percentEncodedPath
    } else {
      guard ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
        webOrigins.contains(where: { origin in
          origin.scheme?.lowercased() == components.scheme?.lowercased()
            && origin.host?.lowercased() == components.host?.lowercased()
            && origin.port == components.port
        }) else { return nil }
      path = components.percentEncodedPath
    }
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.first == "", let root = parts.dropFirst().first,
      ["u", "people", "l", "links", "messages"].contains(String(root)),
      (parts.count == 3 || (root == "u" && parts.count == 4)),
      parts.dropFirst().allSatisfy({ part in
        guard let value = String(part).removingPercentEncoding else { return false }
        return !value.isEmpty && !value.contains("/") && !value.contains("\\") && value != "." && value != ".."
      }) else { return nil }
    self.path = path
    var query: [String: String] = [:]
    for item in components.queryItems ?? [] where ["group", "post", "edit", "attach", "settings", "week"].contains(item.name) {
      if let value = item.value { query[item.name] = value }
    }
    self.query = query
  }
}

public enum ReadableRouteReadiness {
  public static func canResolve(userID: String?, emailVerified: Bool) -> Bool {
    guard let userID, !userID.isEmpty else { return false }
    return emailVerified
  }
}
