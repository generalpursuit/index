import Foundation
import XCTest
@testable import IndexCore

final class ThemePreferenceTests: XCTestCase {
  func testDefaultAndInvalidPreferenceFollowSystem() {
    for value in [nil, "", "invalid", "system"] as [String?] {
      let preference = ThemePreference(storedValue: value)
      XCTAssertEqual(preference, .system)
      XCTAssertEqual(preference.resolved(systemIsDark: false), .light)
      XCTAssertEqual(preference.resolved(systemIsDark: true), .dark)
    }
  }
  func testDevicePreferenceSurvivesAccountDataRemoval() throws {
    let suite = "IndexThemeTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.set("dark", forKey: ThemePreference.storageKey)
    defaults.set("dummy-account", forKey: "test-account")
    defaults.removeObject(forKey: "test-account")
    let restored = ThemePreference(storedValue: defaults.string(forKey: ThemePreference.storageKey))
    XCTAssertEqual(restored, .dark)
    XCTAssertEqual(restored.resolved(systemIsDark: false), .dark)
    XCTAssertEqual(ThemePreference.light.resolved(systemIsDark: true), .light)
  }
}
