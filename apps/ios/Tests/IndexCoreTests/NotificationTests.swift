import Foundation
import Testing
@testable import IndexCore

@Test func notificationPermissionReflectsOSDenial() {
  #expect(!NotificationPermission.denied.allowsAlerts)
  #expect(!NotificationPermission.notDetermined.allowsAlerts)
  #expect(NotificationPermission.authorized.allowsAlerts)
  #expect(NotificationPermission.provisional.allowsAlerts)
}
@Test func notificationDestinationRemainsAccountBoundAndReadable() throws {
  let click = try JSONDecoder().decode(NotificationDestination.self, from: Data(#"{"id":"event","recipientId":"alice","path":"/messages/abc_123","conversationId":"conversation"}"#.utf8))
  let origin = URL(string: "https://canonical.example")!
  #expect(click.url(webURL: origin, accountID: "alice")?.absoluteString == "https://canonical.example/messages/abc_123")
  #expect(click.url(webURL: origin, accountID: "bob") == nil)
  // Signed-out clicks may be retained; ReadableRouteReadiness still gates resolving them.
  #expect(click.url(webURL: origin, accountID: nil) != nil)
  #expect(!ReadableRouteReadiness.canResolve(userID: "alice", emailVerified: false))
  #expect(ReadableRouteReadiness.canResolve(userID: "alice", emailVerified: true))
  for path in ["https://evil.example", "//evil.example", "/messages/../settings", "/l/secret?token=x", "/people/id"] {
    let invalid = NotificationDestination(id: "event", recipientId: "alice", path: path, conversationId: nil)
    #expect(invalid.url(webURL: origin, accountID: "alice") == nil)
  }
}
@Test func notificationDefaultsDecodeWithoutPreviewLeaks() throws {
  let prefs = try JSONDecoder().decode(NotificationPreferences.self, from: Data(#"{"message":true,"comment":true,"mention":true,"request":true,"follow":true,"accepted":true,"previews":false}"#.utf8))
  #expect(prefs.message && prefs.comment && prefs.mention && prefs.request && prefs.follow && prefs.accepted)
  #expect(!prefs.previews)
}
