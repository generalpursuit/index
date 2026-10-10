import Foundation
import Security

public struct NotificationPreferences: Codable, Sendable {
  public var message: Bool
  public var comment: Bool
  public var mention: Bool
  public var request: Bool
  public var follow: Bool
  public var accepted: Bool
  public var previews: Bool
}
public struct NotificationCapabilities: Decodable, Sendable {
  public let apns: Bool
  public let sessionId: String
}
public struct NotificationRegistration: Decodable, Sendable { public let id: String }
public struct NotificationDeviceStatus: Decodable, Sendable { public let registered: Bool }
public struct NotificationDestination: Codable, Sendable, Equatable {
  public let id: String
  public let recipientId: String
  public let path: String
  public let conversationId: String?
  public func url(webURL: URL, accountID: String?) -> URL? {
    guard accountID == nil || accountID == recipientId,
      path.range(of: #"^/(messages|l|u)/[a-zA-Z0-9_-]+$"#, options: .regularExpression) != nil
    else { return nil }
    return URL(string: path, relativeTo: webURL)?.absoluteURL
  }
}
public enum NotificationPermission: String, Sendable {
  case notDetermined, denied, authorized, provisional, unsupported
  public var allowsAlerts: Bool { self == .authorized || self == .provisional }
}
/// Separate from session credentials and deliberately not shared with extensions.
public struct NotificationInstallation: Sendable {
  private let server: URL
  public init(server: URL) { self.server = server }
  public func readOrCreate() throws -> String {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.generalpursuit.index.notifications.\(server.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))",
      kSecAttrAccount as String: "installation"]
    var read = query
    read[kSecReturnData as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(read as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) { return value }
    guard status == errSecItemNotFound else { throw CredentialError(status: status) }
    var bytes = [UInt8](repeating: 0, count: 32)
    let randomStatus = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard randomStatus == errSecSuccess else { throw CredentialError(status: randomStatus) }
    let value = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    var insert = query
    insert[kSecValueData as String] = Data(value.utf8)
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let inserted = SecItemAdd(insert as CFDictionary, nil)
    guard inserted == errSecSuccess else { throw CredentialError(status: inserted) }
    return value
  }
}
