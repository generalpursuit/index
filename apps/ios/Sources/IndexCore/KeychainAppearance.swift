import Foundation
import Security

/// A separate, non-account item carries the device preference to the sandboxed extension.
/// It never contains a session, URL or account identity, and logout leaves it intact.
public struct KeychainAppearance: Sendable {
  let accessGroup: String
  public init(accessGroup: String) { self.accessGroup = accessGroup }
  private var query: [String: Any] {
    var value: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.generalpursuit.index.appearance", kSecAttrAccount as String: "device",
      kSecAttrAccessGroup as String: accessGroup]
    #if os(macOS)
    value[kSecUseDataProtectionKeychain as String] = true
    #endif
    return value
  }
  public func read() -> ThemePreference {
    var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return .system }
    return ThemePreference(storedValue: String(data: data, encoding: .utf8))
  }
  public func write(_ preference: ThemePreference) throws {
    let attributes: [String: Any] = [kSecValueData as String: Data(preference.rawValue.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(attributes, uniquingKeysWith: { _, new in new }) as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw CredentialError(status: status) }
  }
}
