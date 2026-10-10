import Foundation

/// Client-side input feedback for the documented group input contract. Availability (including
/// case-insensitive names and historical slugs) is always decided atomically by the server.
public struct GroupDraft: Sendable {
  public var name: String
  public var locked: Bool
  public let original: LinkGroup?
  public init(group: LinkGroup? = nil) {
    original = group
    name = group?.name ?? ""
    locked = group?.kind == "starred" || group?.visibility == .private
  }
  public var alwaysPrivate: Bool { original?.kind == "starred" }
  public var isCustom: Bool { original == nil || original?.kind == "custom" }
  public var visibility: Visibility { locked || alwaysPrivate ? .private : .public }
  public var changesPrivacy: Bool { original.map { $0.visibility != visibility } ?? false }
  public var normalizedName: String {
    name.precomposedStringWithCompatibilityMapping
      .replacingOccurrences(of: "[ \\t\\r\\n\\f\\u000B]+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: CharacterSet(charactersIn: " \u{FEFF}"))
  }
  public var validationError: String? {
    guard isCustom else { return nil }
    let normalized = normalizedName
    if normalized.isEmpty { return "Give the group a name." }
    if normalized.utf16.count > 100 { return "Use 100 characters or fewer." }
    // ASCII mapping only, matching @index/api/routes (not locale-dependent lowercasing).
    let asciiLower = String(normalized.unicodeScalars.map { scalar -> Character in
      Character(String(UnicodeScalar((65...90).contains(scalar.value) ? scalar.value + 32 : scalar.value)!))
    })
    let slug = asciiLower.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
      .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    if ["all", "favorites", "starred", "settings"].contains(slug) { return "This group name is reserved." }
    return nil
  }
  public var body: [String: JSONValue] {
    var result: [String: JSONValue] = ["visibility": .string(visibility.rawValue)]
    if isCustom { result["name"] = .string(normalizedName) }
    return result
  }
  public static func privacyDescription(locked: Bool) -> String {
    locked ? "Only you can see this group and its links." : "Visible to anyone who can see your profile."
  }
  public static func saveError(_ error: Error) -> String {
    if case APIError.server(409, _) = error {
      return "That group name or address is already reserved. Choose another name."
    }
    return error.localizedDescription
  }
}
