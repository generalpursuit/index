import Foundation
import IndexCore
import IndexFeatures
import Observation
import Network

@MainActor @Observable
final class AppModel {
  var api: APIClient?
  let session = AccountSession()
  let navigation = AppNavigation()
  private let emptyDrafts = MessageDrafts()
  var store: AccountStore?
  let dataBudget = DataBudget()
  var drafts: MessageDrafts { store?.drafts ?? emptyDrafts }
  var profile: Profile? {
    get { store?.profile ?? session.profile }
    set {
      if let store, let newValue, newValue.id != store.accountID { return }
      session.profile = newValue
      if let newValue { store?.updateProfile(newValue) }
    }
  }
  var verificationUser: AuthUser? { session.verificationUser }
  // Routing resumes deferred external URLs when this changes, including a verified
  // transition for the SAME account. No private destination resolves while restricted.
  var verifiedSessionRevision: Int { session.verifiedRevision }
  var restoring = true
  var sessionError: String?
  private var checkingSession = false
  var sessionReady: Bool { store?.sessionVerified == true && !session.provisional }
  /// Set once the API rejects this release; the app cannot continue until it is updated.
  var updateRequired = false
  var error: String?
  var configurationError: String?
  // Errors are presented by the frontmost sheet, including local/nested sheets.
  var sheetPresentations: [UUID] = []
  var unreadMessages: Int { store?.unreadMessages ?? 0 }
  var unreadActivity: Int { store?.unreadActivity ?? 0 }
  var undoLink: SavedLink?
  var webURL: URL?
  func openLink(_ link: SavedLink) { _ = store?.link(link.id, opening: link); navigation.openLink(link) }
  func present(_ destination: Destination) { navigation.present(destination) }
  func navigate(_ destination: Destination) { navigation.navigate(destination) }
  func preload(_ link: SavedLink) {
    guard let store, store.active, !dataBudget.constrained, !ProcessInfo.processInfo.isLowPowerModeEnabled else { return }
    Task { await store.prefetch(link) }
  }
  func openProfile(_ person: Person) { store?.seed(person); navigate(.profile(person.id)) }
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
      api = try APIClient(
        baseURL: url,
        credentials: KeychainCredentials(server: url, accessGroup: Bundle.main.object(forInfoDictionaryKey: "IndexKeychainGroup") as? String),
        onUpdateRequired: { [weak self] in Task { @MainActor [weak self] in self?.updateRequired = true } })
      if let api, let account = api.provisionalAccountID {
        let snapshot: Profile? = api.cached("/me/profile")
        let cached = snapshot?.id == account ? snapshot : nil
        let identity = cached ?? .summary(.clearedAccount(account))
        session.provision(identity)
        navigation.acceptAccount(account)
        store = AccountStore(api: api, profile: identity, summaryOnly: cached == nil, sessionVerified: false)
        restoring = false
      }
    } catch { configurationError = error.localizedDescription }
  }
  func restore() async {
    guard let api, !checkingSession else { return }
    checkingSession = true
    defer { restoring = false; checkingSession = false }
    let generation = session.generation
    let restored: AuthSession?
    do {
      restored = try await api.restore()
      guard generation == session.generation else { return }
    } catch {
      guard generation == session.generation, !Task.isCancelled, !(error is CancellationError) else { return }
      if session.provisional, api.provisionalAccountID == session.profile?.id, !removesSession(error) {
        sessionError = error.localizedDescription
      } else {
        if session.provisional, api.provisionalAccountID == nil { clearAccount() }
        handle(error)
      }
      return
    }
    sessionError = nil
    var acceptingGeneration = generation
    do {
      if let restored, restored.user.emailVerified, let profile, profile.id == restored.user.id, let store {
        if session.provisional { try session.verified(profile, generation: generation) }
        store.verifySession()
        let refreshed: Profile = try await api.request("/me/profile")
        guard generation == session.generation else { throw CancellationError() }
        guard refreshed.id == restored.user.id else { throw APIError.invalidResponse }
        self.profile = refreshed
      } else if let restored {
        acceptingGeneration += 1
        try await acceptSession(restored)
      }
      else { clearAccount(preserveUnownedRoute: true) }
    } catch { if acceptingGeneration == session.generation { handle(error) } }
  }
  private func removesSession(_ error: Error) -> Bool {
    switch error {
    case APIError.unauthenticated, APIError.emailNotVerified, APIError.updateRequired: true
    case APIError.server(let status, _): status == 401 || status == 403
    default: false
    }
  }
  func signIn(identifier: String, password: String) async throws {
    guard let api else { throw APIError.invalidServer }
    await NotificationController.shared.disable()
    try await authenticate { try await api.signIn(identifier: identifier, password: password) }
  }
  func signUp(name: String, username: String, email: String, password: String) async throws {
    guard let api else { throw APIError.invalidServer }
    try await authenticate { try await api.signUp(name: name, username: username, email: email, password: password) }
  }
  private func authenticate(_ request: () async throws -> AuthSession) async throws {
    beginAuthentication()
    var generation = session.generation
    do {
      let restored = try await request()
      guard generation == session.generation else { throw CancellationError() }
      // Accepting a session begins a new generation. The button belongs to the login
      // generation, so authentication owns error delivery across this transition.
      generation += 1
      try await acceptSession(restored)
    } catch {
      if generation == session.generation { handle(error) }
      throw error
    }
  }
  private func beginAuthentication() {
    session.clear()
    navigation.resetPresentation()
    clearPrivateFeatures()
  }
  func securityChanged() async {
    restoring = true
    beginAuthentication()
    await restore()
  }
  private func acceptSession(_ session: AuthSession) async throws {
    guard let api else { throw APIError.invalidServer }
    if !session.user.emailVerified || (profile != nil && profile?.id != session.user.id) {
      NotificationController.shared.clearAccount(preservePendingClick: restoring || (self.session.provisional && profile?.id == session.user.id))
    }
    navigation.acceptAccount(session.user.id)
    clearPrivateFeatures()
    let generation = self.session.begin(session.user)
    if session.user.emailVerified {
      do {
        let snapshot: Profile? = api.cached("/me/profile")
        let cached = snapshot?.id == session.user.id ? snapshot : nil
        let identity = cached ?? Profile.summary(Person.accountIdentity(session.user))
        try self.session.verified(identity, generation: generation)
        store = AccountStore(api: api, profile: identity, summaryOnly: cached == nil)
        restoring = false
        let profile: Profile = try await api.request("/me/profile")
        try Task.checkCancellation()
        guard generation == self.session.generation else { throw CancellationError() }
        guard profile.id == session.user.id else { throw APIError.invalidResponse }
        self.profile = profile
      } catch {
        guard generation == self.session.generation else { throw CancellationError() }
        throw error
      }
    }
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
  }
  private func clearPrivateFeatures() {
    store?.clear()
    store = nil
    sessionError = nil
    emptyDrafts.clear()
    undoLink = nil
    sheetPresentations = []
  }
  func handle(_ error: Error) {
    if error is CancellationError || Task.isCancelled { return }
    // The update screen replaces the app; an error alert would only repeat it.
    if case APIError.updateRequired = error { return }
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
  func open(_ url: URL) { openReadableURL(url) }
  func refreshPulse() async {
    guard let store else { return }
    let generation = session.generation
    do { try await store.pulse() }
    catch { if generation == session.generation { handleSessionError(error) } }
  }
}

@MainActor @Observable
final class DataBudget {
  private(set) var constrained = true
  private let monitor = NWPathMonitor()
  init() {
    monitor.pathUpdateHandler = { @Sendable [weak self] path in
      let constrained = path.isConstrained || path.status != .satisfied
      Task { @MainActor [weak self] in self?.constrained = constrained }
    }
    monitor.start(queue: DispatchQueue(label: "com.generalpursuit.index.prefetch"))
  }
}
