import IndexCore
import SwiftUI

@main
struct IndexApp: App {
  @State private var app = AppModel()
  var body: some Scene {
    WindowGroup {
      RootView().environment(app).preferredColorScheme(.dark).tint(.white)
        .onOpenURL { app.open($0) }
    }
  }
}

enum Destination: Hashable {
  case profile(String)
  case link(String)
  case messages
  case conversation(String)
  case connections(String)
  case add(String, String?, SavedLink?)
  case recipients(SavedLink?)
  case settings
  case group(LinkGroup?)
}
enum AppTab: String, CaseIterable {
  case feed, discover, add, activity, messages, profile
  var symbol: String {
    switch self {
    case .feed: "house"
    case .discover: "magnifyingglass"
    case .add: "plus"
    case .activity: "bell"
    case .messages: "bubble.right"
    case .profile: "person"
    }
  }
  var title: String { self == .feed ? "Home" : rawValue.capitalized }
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
  var restoring = true
  var error: String?
  var configurationError: String?
  var path: [Destination] = []
  var tab = AppTab.feed
  var revision = 0
  var unreadMessages = 0
  var unreadActivity = 0
  var drafts: [String: MessageDraft] = [:]
  var openingLink: SavedLink?
  var openingConversation: Conversation?
  func openLink(_ link: SavedLink) {
    openingLink = link
    path.append(.link(link.id))
  }
  var webURL: URL?
  var showsTabs: Bool {
    guard let destination = path.last else { return true }
    switch destination {
    case .profile, .messages, .connections: return true
    default: return false
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
      api = try APIClient(baseURL: url, credentials: KeychainCredentials(server: url))
    } catch { configurationError = error.localizedDescription }
  }
  func restore() async {
    defer { restoring = false }
    guard let api else { return }
    do {
      if try await api.restore() != nil { profile = try await api.request("/me/profile") }
    } catch APIError.unauthenticated { clearAccount() } catch {
      self.error = error.localizedDescription
    }
  }
  func signIn(identifier: String, password: String) async throws {
    guard let api else { throw APIError.invalidServer }
    let _ = try await api.signIn(identifier: identifier, password: password)
    profile = try await api.request("/me/profile")
    revision += 1
  }
  func signUp(name: String, username: String, email: String, password: String) async throws {
    guard let api else { throw APIError.invalidServer }
    let _ = try await api.signUp(name: name, username: username, email: email, password: password)
    profile = try await api.request("/me/profile")
    revision += 1
  }
  func signOut() async {
    guard let api else { return }
    do { try await api.signOut() } catch { self.error = error.localizedDescription }
    clearAccount()
  }
  func clearAccount() {
    profile = nil
    drafts = [:]
    openingLink = nil
    openingConversation = nil
    path = []
    tab = .feed
    unreadMessages = 0
    unreadActivity = 0
    revision += 1
  }
  func handle(_ error: Error) {
    if error is CancellationError { return }
    if case APIError.unauthenticated = error { clearAccount() }
    self.error = error.localizedDescription
  }
  func changed() { revision += 1 }
  func open(_ url: URL) {
    var parts = url.pathComponents.filter { $0 != "/" }
    if url.scheme == "index", let host = url.host { parts.insert(host, at: 0) }
    guard parts.count >= 2 else { return }
    if parts[0] == "people" { path.append(.profile(parts[1])) }
    if parts[0] == "links" { path.append(.link(parts[1])) }
  }
  func pollUnread() async {
    guard let api, profile != nil else { return }
    do {
      async let messages: UnreadCount = api.request("/me/messages/unread")
      async let activity: ActivityPage = api.request("/me/activity", query: ["limit": "1"])
      unreadMessages = try await messages.unreadCount
      unreadActivity = try await activity.unreadCount
    } catch { if case APIError.unauthenticated = error { handle(error) } }
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
      } else if app.profile == nil {
        LoginView()
      } else {
        NavigationStack(path: $app.path) {
          Group {
            switch app.tab {
            case .feed, .add: FeedView()
            case .discover: DiscoverView()
            case .activity: ActivityView()
            case .messages: MessagesView()
            case .profile: ProfileView(userID: app.userID)
            }
          }
          .navigationDestination(for: Destination.self) { destination in
            switch destination {
            case .profile(let id): ProfileView(userID: id)
            case .link(let id): LinkDetailView(linkID: id)
            case .messages: MessagesView()
            case .conversation(let id): ConversationView(conversationID: id)
            case .connections(let initial): ConnectionsView(initial: initial)
            case .add(let week, let group, let edit):
              AddLinkView(week: week, groupID: group, editing: edit)
            case .recipients(let link): RecipientView(attachment: link)
            case .settings: SettingsView()
            case .group(let group): GroupEditorView(group: group)
            }
          }
          .background(Color.black)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
          if app.showsTabs {
            HStack {
              ForEach(AppTab.allCases, id: \.self) { tab in
                Button {
                  if tab == .add {
                    app.path.append(.add(Week.monday(), nil, nil))
                  } else {
                    app.path = []
                    app.tab = tab
                  }
                } label: {
                  Image(systemName: tab.symbol).font(.system(size: 22)).frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .foregroundStyle(app.tab == tab ? .white : .gray)
                    .overlay(alignment: .topTrailing) {
                      if (tab == .activity && app.unreadActivity > 0)
                        || (tab == .messages && app.unreadMessages > 0)
                      {
                        Circle().fill(.white).frame(width: 5, height: 5).padding(.trailing, 19)
                          .padding(.top, 8)
                      }
                    }
                }.buttonStyle(.plain).accessibilityLabel(tab.title).accessibilityAddTraits(
                  app.tab == tab ? .isSelected : [])
              }
            }.padding(.horizontal, 12).background(.black)
          }
        }
        .task(id: scenePhase) {
          guard scenePhase == .active else { return }
          while !Task.isCancelled {
            await app.pollUnread()
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity).background(.black)
    .alert(
      "Couldn’t complete that",
      isPresented: Binding(get: { app.error != nil }, set: { if !$0 { app.error = nil } })
    ) {
      Button("OK") { app.error = nil }
    } message: {
      Text(app.error ?? "")
    }
  }
}
