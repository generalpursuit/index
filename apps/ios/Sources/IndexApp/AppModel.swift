import Foundation
import IndexCore
import IndexFeatures
import Observation

@MainActor @Observable
final class AppModel {
  var api: APIClient?
  let session = AccountSession()
  let navigation = AppNavigation()
  let drafts = MessageDrafts()
  var profile: Profile? {
    get { session.profile }
    set { session.profile = newValue }
  }
  var verificationUser: AuthUser? { session.verificationUser }
  // Routing resumes deferred external URLs when this changes, including a verified
  // transition for the SAME account. No private destination resolves while restricted.
  var verifiedSessionRevision: Int { session.verifiedRevision }
  var restoring = true
  var error: String?
  var configurationError: String?
  // Errors are presented by the frontmost sheet, including local/nested sheets.
  var sheetPresentations: [UUID] = []
  var revision = 0
  var unreadMessages = 0
  var unreadActivity = 0
  var undoLink: SavedLink?
  var webURL: URL?
  func openLink(_ link: SavedLink) { navigation.openLink(link) }
  func present(_ destination: Destination) { navigation.present(destination) }
  func navigate(_ destination: Destination) { navigation.navigate(destination) }
  var showsTabs: Bool { navigation.showsTabs }
  var activeTab: AppTab? { navigation.activeTab(account: userID) }
  var userID: String { profile?.id ?? "" }
  init() {
    #if DEBUG
      let fallback = "http://localhost:3002"
    #else
      let fallback = ""
    #endif
    let address =
      ProcessInfo.processInfo.environment["INDEX_API_URL"] ?? Bundle.main.object(
        forInfoDictionaryKey: "IndexAPIURL") as? String ?? fallback
    webURL = URL(
      string: ProcessInfo.processInfo.environment["INDEX_WEB_URL"] ?? Bundle.main.object(
        forInfoDictionaryKey: "IndexWebURL") as? String ?? "http://localhost:4173")
    do {
      guard let url = URL(string: address), !address.contains("$(") else {
        throw APIError.invalidServer
      }
      api = try APIClient(baseURL: url, credentials: KeychainCredentials(server: url, accessGroup: Bundle.main.object(forInfoDictionaryKey: "IndexKeychainGroup") as? String))
    } catch { configurationError = error.localizedDescription }
  }
  func restore() async {
    defer { restoring = false }
    guard let api else { return }
    let generation = session.generation
    let restored: AuthSession?
    do {
      restored = try await api.restore()
      guard generation == session.generation else { return }
    } catch {
      guard generation == session.generation else { return }
      handle(error)
      return
    }
    do {
      if let restored { try await acceptSession(restored) }
      else { clearAccount(preserveUnownedRoute: true) }
    } catch { handle(error) }
  }
  func signIn(identifier: String, password: String) async throws {
    guard let api else { throw APIError.invalidServer }
    await NotificationController.shared.disable()
    let session = try await api.signIn(identifier: identifier, password: password)
    try await acceptSession(session)
  }
  func signUp(name: String, username: String, email: String, password: String) async throws {
    guard let api else { throw APIError.invalidServer }
    let session = try await api.signUp(name: name, username: username, email: email, password: password)
    try await acceptSession(session)
  }
  private func acceptSession(_ session: AuthSession) async throws {
    guard let api else { throw APIError.invalidServer }
    if !session.user.emailVerified || (profile != nil && profile?.id != session.user.id) { NotificationController.shared.clearAccount(preservePendingClick: restoring) }
    navigation.acceptAccount(session.user.id)
    clearPrivateFeatures()
    let generation = self.session.begin(session.user)
    if session.user.emailVerified {
      do {
        let profile: Profile = try await api.request("/me/profile")
        try Task.checkCancellation()
        try self.session.verified(profile, generation: generation)
      } catch {
        guard generation == self.session.generation else { throw CancellationError() }
        throw error
      }
    }
    revision += 1
  }
  func verifyEmail(code: String) async throws {
    guard let api else { throw APIError.invalidServer }
    try await api.verifyEmail(code: code)
    guard let session = try await api.restore() else { throw APIError.unauthenticated }
    try await acceptSession(session)
  }
  func signOut() async {
    guard let api else { return }
    let notificationRemoval = NotificationController.shared.beginDisable()
    clearAccount()
    let generation = session.generation
    do { try await api.signOut() } catch {
      if generation == session.generation { self.error = error.localizedDescription }
    }
    await notificationRemoval.value
  }
  func clearAccount(preserveUnownedRoute: Bool = false) {
    NotificationController.shared.clearAccount(preservePendingClick: restoring)
    navigation.clearAccount(preserveUnownedRoute: preserveUnownedRoute)
    session.clear()
    clearPrivateFeatures()
    revision += 1
  }
  private func clearPrivateFeatures() {
    drafts.clear()
    undoLink = nil
    sheetPresentations = []
    unreadMessages = 0
    unreadActivity = 0
  }
  func handle(_ error: Error) {
    if error is CancellationError || Task.isCancelled { return }
    if case APIError.unauthenticated = error { clearAccount() }
    if case APIError.emailNotVerified = error {
      NotificationController.shared.clearAccount()
      session.clear()
      navigation.resetPresentation()
      clearPrivateFeatures()
      Task { await restore() }
    }
    self.error = error.localizedDescription
  }
  func handleSessionError(_ error: Error) {
    switch error {
    case APIError.unauthenticated, APIError.emailNotVerified: handle(error)
    default: break
    }
  }
  func changed() { revision += 1 }
  func open(_ url: URL) { openReadableURL(url) }
  func pollUnread() async {
    guard let api, profile != nil else { return }
    let generation = session.generation
    do {
      async let messages: UnreadCount = api.request("/me/messages/unread")
      async let activity: ActivityPage = api.request("/me/activity", query: ["limit": "1"])
      let counts = try await (messages.unreadCount, activity.unreadCount)
      guard generation == session.generation, profile != nil else { return }
      unreadMessages = counts.0
      unreadActivity = counts.1
    } catch { if generation == session.generation { handleSessionError(error) } }
  }
}
