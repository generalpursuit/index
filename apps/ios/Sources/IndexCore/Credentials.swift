import Foundation
import Security

public protocol CredentialStore: Sendable {
  func read() throws -> String?
  func write(_ token: String?) throws
}
public struct KeychainCredentials: CredentialStore {
  private let service: String
  private let accessGroup: String?
  private let valid: Bool
  public init(server: URL, accessGroup: String? = nil) {
    let scope = try? APIScope.normalize(server.absoluteString)
    service = "com.generalpursuit.index.session.\(scope ?? "invalid")"
    self.accessGroup = accessGroup
    valid = scope != nil && (accessGroup == nil || (!accessGroup!.isEmpty && !accessGroup!.contains("$(")))
  }
  private var query: [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "session",
    ]
    if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
    #if os(macOS)
      if accessGroup != nil { query[kSecUseDataProtectionKeychain as String] = true }
    #endif
    return query
  }
  public func read() throws -> String? {
    guard valid else { throw APIError.invalidServer }
    var query = query
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data,
      let token = String(data: data, encoding: .utf8)
    else { throw CredentialError(status: status) }
    return token
  }
  public func write(_ token: String?) throws {
    guard valid else { throw APIError.invalidServer }
    guard let token else {
      let status = SecItemDelete(query as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        throw CredentialError(status: status)
      }
      return
    }
    let attributes: [String: Any] = [
      kSecValueData as String: Data(token.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      let result = SecItemAdd(
        query.merging(attributes, uniquingKeysWith: { _, new in new }) as CFDictionary, nil)
      guard result == errSecSuccess else { throw CredentialError(status: result) }
    } else if status != errSecSuccess {
      throw CredentialError(status: status)
    }
  }
}
public struct CredentialError: LocalizedError {
  public let status: OSStatus
  public var errorDescription: String? {
    "Could not access your secure session (\(status)). Unlock the device and try again."
  }
}

/// The extension may read the current credential but cannot rotate, clear, or resurrect it.
public struct ReadOnlyCredentials: CredentialStore {
  private let source: any CredentialStore
  public init(_ source: any CredentialStore) { self.source = source }
  public func read() throws -> String? { try source.read() }
  public func write(_ token: String?) throws {}
}
