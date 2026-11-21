import Foundation

public struct ShareResult: Decodable, Sendable {
  public let status: String
  public let link: SavedLink
}
public struct ShareDraft: Sendable {
  public var url: String
  public var groupID: String?
  private var attemptedPayload: String?
  private var requestID = UUID()
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
    let address = url.trimmingCharacters(in: .whitespacesAndNewlines)
    let key = "\(accountID.utf8.count):\(accountID)|\(address.utf8.count):\(address)|\(groupID ?? "")|\(saveAgain)"
    let id = attemptedPayload == key ? requestID : UUID()
    let body = try Self.body(url: address, groupID: groupID, requestID: id, saveAgain: saveAgain)
    attemptedPayload = key
    requestID = id
    return body
  }
  public static func body(url: String, groupID: String?, requestID: UUID, saveAgain: Bool) throws -> [String: JSONValue] {
    guard validURL(url) != nil else { throw APIError.server(400, "Enter one HTTP or HTTPS link.") }
    return ["url": .string(url.trimmingCharacters(in: .whitespacesAndNewlines)), "groupId": groupID.map(JSONValue.string) ?? .null,
            "requestId": .string(requestID.uuidString), "saveAgain": .bool(saveAgain)]
  }
}

extension APIClient {
  public func shareDestinations(ownerID: String) async throws -> [LinkGroup] {
    var groups: [LinkGroup] = []
    var cursor: String?
    repeat {
      var query = ["ownerId": ownerID, "limit": "100"]
      if let cursor { query["cursor"] = cursor }
      let page: Page<LinkGroup> = try await request("/groups", query: query)
      groups += page.items.filter { $0.kind == "custom" && $0.ownerId == ownerID }
      cursor = page.nextCursor
    } while cursor != nil
    return groups
  }
}
