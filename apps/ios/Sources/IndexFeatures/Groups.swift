import Foundation
import IndexCore

/// Both profile filters and group pickers need the complete permitted group list.
public func loadGroups(api: any FeatureAPI, ownerID: String) async throws -> [LinkGroup] {
  var groups: [LinkGroup] = []
  var cursor: String?
  var visited = Set<String>()
  repeat {
    if let cursor, !visited.insert(cursor).inserted { throw APIError.invalidResponse }
    var query = ["ownerId": ownerID, "limit": "100"]
    query["cursor"] = cursor
    let page: Page<LinkGroup> = try await api.get("/groups", query: query)
    try Task.checkCancellation()
    groups += page.items
    cursor = page.nextCursor
  } while cursor != nil
  return unique(groups)
}
