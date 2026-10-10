import Foundation

/// Device preference. Never stored in account payloads, response caches, or Keychain credentials.
public enum ThemePreference: String, CaseIterable, Sendable {
  case system, light, dark
  public static let storageKey = "index.theme"

  public init(storedValue: String?) {
    self = Self(rawValue: storedValue ?? "") ?? .system
  }

  public func resolved(systemIsDark: Bool) -> ThemePreference {
    self == .system ? (systemIsDark ? .dark : .light) : self
  }
}
