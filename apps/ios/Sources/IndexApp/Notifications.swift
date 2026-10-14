import Foundation
import IndexCore
import IndexFeatures
import SwiftUI
import UserNotifications
#if os(iOS)
import UIKit

@MainActor final class NotificationAppDelegate: NSObject, UIApplicationDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    _ = NotificationController.shared
    return true
  }
  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    Task { @MainActor in await NotificationController.shared.receivedToken(token) }
  }
  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    Task { @MainActor in NotificationController.shared.registrationFailed() }
  }
}
#endif

@MainActor @Observable
final class NotificationController: NSObject, UNUserNotificationCenterDelegate {
  static let shared = NotificationController()
  var permission = NotificationPermission.notDetermined
  var registered = false
  /// Whether the server delivers through APNs; nil until it answers.
  var configured: Bool?
  /// The account whose registration has been checked, whether or not the check succeeded.
  var checkedAccount: String?
  var error: String?
  private weak var app: AppModel?
  private var generation = 0
  private var binding: (installation: String, sessionID: String, accountID: String)?
  private var token: String?
  private var pendingClick: NotificationDestination?
  private var activeConversationID: String?
  private var foreground = false
  private var reportedActive: (conversation: String?, foreground: Bool)?
  private var defaultsKey: String { "index.notifications.optin.\(app?.api?.baseURL.absoluteString ?? "")" }
  override init() {
    super.init()
    UNUserNotificationCenter.current().delegate = self
  }
  func refreshPermission() async {
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    switch settings.authorizationStatus {
    case .authorized: permission = .authorized
    case .provisional: permission = .provisional
    #if os(iOS)
    case .ephemeral: permission = .provisional
    #endif
    case .denied: permission = .denied
    case .notDetermined: permission = .notDetermined
    @unknown default: permission = .unsupported
    }
  }
  func synchronize(_ app: AppModel) async {
    self.app = app
    let version = generation
    let account = app.userID
    guard !account.isEmpty, app.sessionReady, let api = app.api else { return }
    await refreshPermission()
    do {
      let config: NotificationCapabilities = try await api.request("/me/notifications/capabilities")
      guard version == generation, app.userID == account, app.verificationUser == nil else { return }
      configured = config.apns
      if !permission.allowsAlerts { await disable(); checkedAccount = account; return }
      if UserDefaults.standard.string(forKey: defaultsKey) == account && config.apns {
        let installation = try NotificationInstallation(server: api.baseURL).readOrCreate()
        binding = (installation, config.sessionId, account)
        let status: NotificationDeviceStatus = try await api.request("/me/notifications/devices/status", method: "POST", body: deviceBody())
        guard version == generation, app.userID == account else { return }
        registered = status.registered
        await setActive(app: app, foreground: foreground)
        #if os(iOS)
        UIApplication.shared.registerForRemoteNotifications()
        #endif
      }
      checkedAccount = account
      resumeClick()
    } catch {
      guard version == generation else { return }
      self.error = "Could not check notification registration."
      checkedAccount = account
    }
  }
  func enable(_ app: AppModel) async {
    self.app = app
    let version = generation, account = app.userID
    guard let api = app.api, !account.isEmpty, app.sessionReady else { return }
    error = nil
    do {
      // Only the Settings button calls enable; restore never requests permission.
      _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
      await refreshPermission()
      guard version == generation, app.userID == account, app.verificationUser == nil else { return }
      guard permission.allowsAlerts else { error = "Notifications are blocked in system settings."; return }
      let config: NotificationCapabilities = try await api.request("/me/notifications/capabilities")
      guard version == generation, app.userID == account else { return }
      configured = config.apns
      guard config.apns else { error = "Notifications aren't available on this server yet."; return }
      binding = (try NotificationInstallation(server: api.baseURL).readOrCreate(), config.sessionId, account)
      UserDefaults.standard.set(account, forKey: defaultsKey)
      #if os(iOS)
      UIApplication.shared.registerForRemoteNotifications()
      #else
      error = "APNs registration is available in the iPhone and iPad app."
      #endif
    } catch { if version == generation { self.error = "Could not enable notifications. Try again." } }
  }
  func receivedToken(_ value: String) async {
    token = value
    guard let binding, let app, let api = app.api, app.userID == binding.accountID, app.sessionReady,
      UserDefaults.standard.string(forKey: defaultsKey) == binding.accountID else { return }
    let version = generation
    let environment = Bundle.main.object(forInfoDictionaryKey: "IndexAPNSEnvironment") as? String ?? ""
    guard ["sandbox", "production"].contains(environment) else { error = "APNs environment is not configured."; return }
    do {
      var body = deviceBody()
      body["kind"] = .string("apns"); body["token"] = .string(value); body["environment"] = .string(environment)
      let _: NotificationRegistration = try await api.request("/me/notifications/devices", method: "POST", body: body)
      guard version == generation, app.userID == binding.accountID else { return }
      registered = true
      await setActive(app: app, foreground: foreground)
    } catch { if version == generation { self.error = "Could not register this device. Try again." } }
  }
  func registrationFailed() { registered = false; error = "Apple could not register this device for push. Try again." }
  private func deviceBody() -> [String: JSONValue] {
    guard let binding else { return [:] }
    return ["installation": .string(binding.installation), "sessionId": .string(binding.sessionID)]
  }
  func beginDisable() -> Task<Void, Never> {
    let api = app?.api, body = deviceBody()
    clearAccount()
    return Task {
      if !body.isEmpty { let _: Success? = try? await api?.request("/me/notifications/devices/remove", method: "POST", body: body) }
    }
  }
  func disable() async { await beginDisable().value }
  /// Synchronous invalidation is essential: old enrollment callbacks cannot bind a new login.
  func clearAccount(preservePendingClick: Bool = false) {
    generation += 1
    UserDefaults.standard.removeObject(forKey: defaultsKey)
    binding = nil; token = nil; registered = false; activeConversationID = nil
    reportedActive = nil
    if !preservePendingClick { pendingClick = nil }
    UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    #if os(iOS)
    UIApplication.shared.unregisterForRemoteNotifications()
    #endif
  }
  func setActive(app: AppModel, foreground: Bool) async {
    self.foreground = foreground
    var conversation: String?
    if foreground, app.navigation.sheet == nil, let last = app.navigation.path.last, case .conversation(let id) = last { conversation = id }
    activeConversationID = conversation
    guard app.sessionReady, binding?.accountID == app.userID, let api = app.api, registered else { return }
    if let reportedActive, reportedActive.conversation == conversation, reportedActive.foreground == foreground { return }
    reportedActive = (conversation, foreground)
    var body = deviceBody(); body["conversationId"] = conversation.map(JSONValue.string) ?? .null
    let _: Success? = try? await api.request("/me/notifications/active", method: "POST", body: body)
  }
  private func destination(_ content: UNNotificationContent) -> NotificationDestination? {
    guard let index = content.userInfo["index"], let data = try? JSONSerialization.data(withJSONObject: index) else { return nil }
    return try? JSONDecoder().decode(NotificationDestination.self, from: data)
  }
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
    let data = try? JSONSerialization.data(withJSONObject: notification.request.content.userInfo["index"] ?? [:])
    let click = data.flatMap { try? JSONDecoder().decode(NotificationDestination.self, from: $0) }
    return await MainActor.run {
      guard let click, self.app?.userID == click.recipientId, self.app?.verificationUser == nil, self.registered else { return [] }
      Task { await self.app?.refreshPulse() }
      if self.foreground && click.conversationId != nil && click.conversationId == self.activeConversationID { return [] }
      return [.banner, .sound]
    }
  }
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    let data = try? JSONSerialization.data(withJSONObject: response.notification.request.content.userInfo["index"] ?? [:])
    guard let data, let click = try? JSONDecoder().decode(NotificationDestination.self, from: data) else { return }
    await MainActor.run { self.pendingClick = click; self.resumeClick() }
  }
  func attach(_ app: AppModel) { self.app = app; resumeClick() }
  private func resumeClick() {
    guard let click = pendingClick, let app, !app.restoring, !app.session.provisional, let web = app.webURL else { return }
    let account = app.profile?.id ?? app.verificationUser?.id
    guard let url = click.url(webURL: web, accountID: account) else { pendingClick = nil; return }
    // Transfer to the existing pending URL gate. Restricted same-ID sessions retain this
    // destination until verifiedSessionRevision resumes authorized resolution.
    Task { await app.refreshPulse() }
    app.open(url)
    app.navigation.pendingRouteAccountID = click.recipientId
    pendingClick = nil
  }
}

struct NotificationSettings: View {
  @Environment(AppModel.self) private var app
  private var preferences: NotificationPreferences? { app.store?.notificationPreferences }
  @State private var saving = false
  @State private var failure: String?
  // A profile gets a follow request while private and a follow while public, never both for
  // the same follow, so one row controls both keys and shows on only when both are on.
  private let rows: [(label: String, description: String, keys: [String])] = [
    ("Messages", "New messages in your conversations", ["message"]),
    ("Comments", "When someone comments on your links", ["comment"]),
    ("Mentions", "When someone mentions you in a comment", ["mention"]),
    ("Followers", "New followers, or follow requests while your profile is private", ["follow", "request"]),
    ("Accepted follow requests", "When someone approves your request to follow them", ["accepted"]),
    ("Show message and comment previews", "Previews are hidden by default. Enabling them may show private text on your lock screen.", ["previews"]),
  ]
  var body: some View {
    let notifications = NotificationController.shared
    VStack(alignment: .leading, spacing: 12) {
      Text("Notifications").font(.headline)
      Text("Your in-app activity is always kept. No notification emails are sent.").font(.footnote).foregroundStyle(IndexPalette.mutedForeground)
      // Capabilities only decide whether a device can be enabled; a registered device can always
      // turn off. Only an explicit answer means push is off; after a failed check, enabling reports why.
      let checking = !notifications.registered && notifications.checkedAccount != app.userID
      let serverOff = notifications.configured == false && !notifications.registered
      Text(
        checking ? "Checking…"
          : serverOff ? "Notifications aren't available on this server yet."
          : notifications.permission == .denied ? "Blocked in system settings."
          : notifications.registered ? "Enabled on this device." : "Alerts are off on this device."
      ).font(.subheadline)
      if !checking && !serverOff {
        AsyncButton {
          if notifications.registered { await notifications.disable() } else { await notifications.enable(app) }
        } label: { Text(notifications.registered ? "Turn off on this device" : "Enable on this device") }
        .buttonStyle(PillStyle()).disabled(!notifications.registered && notifications.permission == .denied)
        #if os(iOS)
        if notifications.permission == .denied {
          Button("Open system settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }.buttonStyle(PillStyle())
        }
        #endif
      }
      Group {
        let preferences = self.preferences ?? ContentPlaceholder.notificationPreferences
        ForEach(rows, id: \.label) { row in
          Toggle(isOn: Binding(get: { row.keys.allSatisfy { value(preferences, $0) } }, set: { newValue in
            Task { await update(row.keys, newValue) }
          })) {
            VStack(alignment: .leading, spacing: 2) {
              Text(row.label)
              Text(row.description).font(.footnote).foregroundStyle(IndexPalette.mutedForeground)
            }
          }.disabled(saving)
        }
      }
      .calmPlaceholder(active: preferences == nil && failure == nil)
      if let message = failure ?? notifications.error { Text(message).font(.footnote).foregroundStyle(IndexPalette.destructive) }
    }.task {
      await notifications.synchronize(app)
      do { try await app.store?.refreshPreferences() } catch { failure = "Could not load notification preferences." }
    }
  }
  private func value(_ p: NotificationPreferences, _ key: String) -> Bool {
    switch key { case "message": p.message; case "comment": p.comment; case "mention": p.mention; case "request": p.request; case "follow": p.follow; case "accepted": p.accepted; default: p.previews }
  }
  private func update(_ keys: [String], _ value: Bool) async {
    saving = true; defer { saving = false }
    do { try await app.store?.setPreferences(keys, value: value) }
    catch { failure = "Could not save notification preferences." }
  }
}
