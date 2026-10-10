import IndexCore
import IndexUI
import SwiftUI

@main
struct IndexApp: App {
  #if os(iOS)
  @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var notificationDelegate
  #endif
  @State private var app = AppModel()
  @AppStorage(ThemePreference.storageKey) private var storedTheme = ThemePreference.system.rawValue
  var body: some Scene {
    WindowGroup {
      RootView().environment(app).preferredColorScheme(ThemePreference(storedValue: storedTheme).colorScheme)
        .tint(IndexPalette.foreground)
        .font(IndexFont.sans()).foregroundStyle(IndexPalette.foreground)
        .task(id: storedTheme) {
          if let group = Bundle.main.object(forInfoDictionaryKey: "IndexKeychainGroup") as? String {
            try? KeychainAppearance(accessGroup: group).write(ThemePreference(storedValue: storedTheme))
          }
        }
        .onOpenURL { app.open($0) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
          if let url = activity.webpageURL { app.open(url) }
        }
    }
  }
}

enum Destination: Hashable, Identifiable {
  case profile(String)
  case collection(String, String)
  case link(String)
  case messages
  case conversation(String)
  case connections(String)
  case add(String, String?, SavedLink?)
  case recipients(SavedLink?)
  case settings
  case group(LinkGroup?)
  var id: Self { self }
}
enum AppTab: String, CaseIterable {
  case feed, discover, activity, messages, profile
  var title: String { self == .feed ? "Home" : self == .profile ? "Your profile" : rawValue.capitalized }
}
struct MessageDraft {
  var body = ""
  var attachment: SavedLink?
  var clientID = UUID().uuidString
  // An uncertain send must be retried with identical content and the same UUID.
  var attemptedBody: String?
  var attemptedLinkID: String?
}
@MainActor @Observable
final class AppModel {
  var api: APIClient?
  var profile: Profile?
  var verificationUser: AuthUser?
  // Routing resumes deferred external URLs when this changes, including a verified
  // transition for the SAME account. No private destination resolves while restricted.
  var verifiedSessionRevision = 0
  var restoring = true
  var error: String?
  var configurationError: String?
  var path: [Destination] = []
  var sheet: Destination?
  // Errors are presented by the frontmost sheet, including local/nested sheets.
  var sheetPresentations: [UUID] = []
  var tab = AppTab.feed
  var revision = 0
  var unreadMessages = 0
  var unreadActivity = 0
  var drafts: [String: MessageDraft] = [:]
  var undoLink: SavedLink?
  var openingLink: SavedLink?
  var openingConversation: Conversation?
  func openLink(_ link: SavedLink) {
    openingLink = link
    present(.link(link.id))
  }
  func present(_ destination: Destination) { sheet = destination }
  func navigate(_ destination: Destination) {
    sheet = nil
    path.append(destination)
  }
  var pendingRouteURL: URL?
  var pendingRouteAccountID: String?
  var routeTask: Task<Void, Never>?
  var webURL: URL?
  var showsTabs: Bool {
    guard let destination = path.last else { return true }
    switch destination {
    case .profile, .collection, .messages, .connections: return true
    default: return false
    }
  }
  var activeTab: AppTab? {
    guard let destination = path.last else { return tab }
    switch destination {
    case .profile(let id), .collection(let id, _): return id == userID ? .profile : nil
    case .messages: return .messages
    default: return nil
    }
  }
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
    do {
      if let session = try await api.restore() { try await acceptSession(session) } else { clearAccount(preserveUnownedRoute: true) }
    } catch APIError.unauthenticated { clearAccount() } catch {
      self.error = error.localizedDescription
    }
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
    routeTask?.cancel()
    routeTask = nil
    if let owner = pendingRouteAccountID, owner != session.user.id { pendingRouteURL = nil }
    pendingRouteAccountID = pendingRouteURL == nil ? nil : session.user.id
    // Verification and account switches must drop all previous private UI state.
    profile = nil
    drafts = [:]
    undoLink = nil
    path = []
    sheet = nil
    openingLink = nil
    openingConversation = nil
    unreadMessages = 0
    unreadActivity = 0
    verificationUser = session.user.emailVerified ? nil : session.user
    if session.user.emailVerified {
      profile = try await api.request("/me/profile")
      verifiedSessionRevision += 1
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
    do { try await api.signOut() } catch { self.error = error.localizedDescription }
    await notificationRemoval.value
  }
  func clearAccount(preserveUnownedRoute: Bool = false) {
    NotificationController.shared.clearAccount(preservePendingClick: restoring)
    routeTask?.cancel()
    routeTask = nil
    if !preserveUnownedRoute || pendingRouteAccountID != nil { pendingRouteURL = nil }
    pendingRouteAccountID = nil
    profile = nil
    verificationUser = nil
    drafts = [:]
    undoLink = nil
    openingLink = nil
    openingConversation = nil
    path = []
    sheet = nil
    tab = .feed
    unreadMessages = 0
    unreadActivity = 0
    revision += 1
  }
  func handle(_ error: Error) {
    if error is CancellationError { return }
    if case APIError.unauthenticated = error { clearAccount() }
    if case APIError.emailNotVerified = error {
      NotificationController.shared.clearAccount()
      profile = nil
      drafts = [:]
      undoLink = nil
      path = []
      sheet = nil
      openingLink = nil
      openingConversation = nil
      Task { await restore() }
    }
    self.error = error.localizedDescription
  }
  func changed() { revision += 1 }
  func open(_ url: URL) { openReadableURL(url) }
  func pollUnread() async {
    guard let api, profile != nil else { return }
    do {
      async let messages: UnreadCount = api.request("/me/messages/unread")
      async let activity: ActivityPage = api.request("/me/activity", query: ["limit": "1"])
      unreadMessages = try await messages.unreadCount
      unreadActivity = try await activity.unreadCount
    } catch { if case APIError.unauthenticated = error { handle(error) }; if case APIError.emailNotVerified = error { handle(error) } }
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  var body: some View {
    @Bindable var app = app
    Group {
      if let message = app.configurationError {
        ContentUnavailableView(
          "Configuration needed", systemImage: "gear", description: Text(message))
      } else if app.restoring {
        ProgressView().task { await app.restore() }
      } else if let pending = app.verificationUser {
        VerificationView(email: pending.email)
      } else if app.profile == nil {
        LoginView()
      } else {
        NavigationStack(path: $app.path) {
          Group {
            switch app.tab {
            case .feed: FeedView()
            case .discover: DiscoverView()
            case .activity: ActivityView()
            case .messages: MessagesView()
            case .profile: ProfileView(userID: app.userID)
            }
          }
          .hideNativeNavigation()
          .navigationDestination(for: Destination.self) { destination in
            destinationView(destination).hideNativeNavigation()
          }
          .background(IndexPalette.background)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
          if app.showsTabs {
            HStack(spacing: 0) {
              ForEach(AppTab.allCases, id: \.self) { tab in
                Button {
                  app.path = []
                  app.tab = tab
                } label: {
                  NavigationIcon(tab: tab).frame(width: 44, height: 44)
                    .foregroundStyle(app.activeTab == tab ? IndexPalette.foreground : IndexPalette.subtleForeground)
                    .overlay(alignment: .topTrailing) {
                      if (tab == .activity && app.unreadActivity > 0)
                        || (tab == .messages && app.unreadMessages > 0)
                      {
                        Circle().fill(IndexPalette.foreground).frame(width: 6, height: 6)
                          .overlay(Circle().stroke(IndexPalette.background, lineWidth: 3))
                          .padding(.trailing, 7).padding(.top, 7)
                      }
                    }
                    .frame(maxWidth: .infinity).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel(tab.title).accessibilityAddTraits(
                  app.activeTab == tab ? .isSelected : [])
              }
            }.padding(.horizontal, 8).frame(height: 66).background(IndexPalette.background)
          }
        }
        .sheet(item: $app.sheet) { destination in
          destinationView(destination).id(destination).indexSheetStyle()
            .presentationDetents(sheetDetents(destination))
        }
        .task(id: scenePhase) {
          guard scenePhase == .active else { return }
          while !Task.isCancelled {
            await app.pollUnread()
            await NotificationController.shared.setActive(app: app, foreground: scenePhase == .active)
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity).background(IndexPalette.background)
    .overlay(alignment: .bottom) { SavedLinkToast().padding(.bottom, 80) }
    .onAppear { NotificationController.shared.attach(app) }
    .onChange(of: app.restoring) { _, restoring in
      if !restoring { NotificationController.shared.attach(app) }
    }
    .onChange(of: app.verifiedSessionRevision, initial: true) { _, _ in
      if app.verificationUser == nil && app.profile != nil {
        app.resumeReadableURL()
        Task { await NotificationController.shared.synchronize(app) }
      }
    }
    .onChange(of: app.path) { _, _ in
      Task { await NotificationController.shared.setActive(app: app, foreground: scenePhase == .active) }
    }
    .onChange(of: scenePhase) { _, phase in
      Task {
        if phase == .active { await NotificationController.shared.synchronize(app) }
        await NotificationController.shared.setActive(app: app, foreground: phase == .active)
      }
    }
    .modifier(AppErrorPresentation())
  }
  @ViewBuilder private func destinationView(_ destination: Destination) -> some View {
    switch destination {
    case .profile(let id): ProfileView(userID: id)
    case .collection(let id, let group): ProfileView(userID: id, groupID: group)
    case .link(let id): LinkDetailView(linkID: id)
    case .messages: MessagesView()
    case .conversation(let id): ConversationView(conversationID: id)
    case .connections(let initial): ConnectionsView(initial: initial)
    case .add(let week, let group, let edit): AddLinkView(week: week, groupID: group, editing: edit)
    case .recipients(let link): RecipientView(attachment: link)
    case .settings: SettingsView()
    case .group(let group): GroupEditorView(group: group)
    }
  }
  private func sheetDetents(_ destination: Destination) -> Set<PresentationDetent> {
    switch destination {
    case .group: [.height(360), .large]
    case .connections, .recipients: [.medium, .large]
    default: [.large]
    }
  }
}
