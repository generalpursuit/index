import Foundation

/// Shared host/extension credential namespace. Paths are case-sensitive; percent encodings
/// are retained. Reject ambiguous scopes rather than ever sending credentials to another API.
public enum APIScope {
  public static func normalize(_ raw: String) throws -> String {
    guard raw.range(of: "%(?![0-9A-Fa-f]{2})", options: .regularExpression) == nil,
      raw.unicodeScalars.allSatisfy({ (33...126).contains($0.value) }), !raw.contains("\\"),
      var parts = URLComponents(string: raw), let scheme = parts.scheme?.lowercased(),
      let host = parts.host?.lowercased(), !host.isEmpty,
      parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
      scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host))
    else { throw APIError.invalidServer }
    // Dot segments and encoded dot segments are rejected, not silently removed.
    let path = parts.percentEncodedPath
    guard !path.split(separator: "/").contains(where: {
      guard let decoded = String($0).removingPercentEncoding else { return true }
      return decoded == "." || decoded == ".." || decoded.contains("/") || decoded.contains("\\")
    }) else { throw APIError.invalidServer }
    parts.scheme = scheme; parts.host = host
    if parts.port == (scheme == "https" ? 443 : 80) { parts.port = nil }
    guard parts.port == nil || (1...65535).contains(parts.port!) else { throw APIError.invalidServer }
    parts.percentEncodedPath = path.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    guard let result = parts.string else { throw APIError.invalidServer }
    return result
  }
}
