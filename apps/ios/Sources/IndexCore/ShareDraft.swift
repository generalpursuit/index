import Foundation

public struct ShareResult: Decodable, Sendable {
  public let status: String
  public let link: SavedLink
}
public struct ShareDraft: Sendable {
  public var url: String
  public var groupID: String?
  private var attemptedPayload: String?
  private var requestID = UUID().uuidString
  public init(url: String = "") { self.url = url }
  public static func validURL(_ input: String) -> URL? {
    let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard raw.utf16.count <= 8192, !raw.contains(where: { $0.isWhitespace }),
      let parts = URLComponents(string: raw), ["https", "http"].contains(parts.scheme?.lowercased() ?? ""),
      let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil else { return nil }
    return parts.url
  }
  /// Keep an unavailable selection intact; only the user may choose Your links instead.
  public static func destination(_ selected: LinkGroup?, in groups: [LinkGroup], complete: Bool) -> (group: LinkGroup?, unavailable: Bool) {
    guard let selected else { return (nil, false) }
    if let current = groups.first(where: { $0.id == selected.id }) { return (current, false) }
    return (selected, complete)
  }
  /// A failed attempt retains its identity. Explicit Save again changes the payload and ID.
  public mutating func body(accountID: String, saveAgain: Bool = false) throws -> [String: JSONValue] {
    guard Self.validURL(url) != nil else { throw APIError.server(400, "Enter one HTTP or HTTPS link.") }
    let address = url.trimmingCharacters(in: .whitespacesAndNewlines)
    let key = "\(accountID.utf8.count):\(accountID)|\(address.utf8.count):\(address)|\(groupID ?? "")|\(saveAgain)"
    if attemptedPayload != key { requestID = UUID().uuidString; attemptedPayload = key }
    return ["url": .string(address), "groupId": groupID.map(JSONValue.string) ?? .null,
            "requestId": .string(requestID), "saveAgain": .bool(saveAgain)]
  }
}
