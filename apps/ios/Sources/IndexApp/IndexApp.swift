import IndexCore
import IndexFeatures
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

struct RootView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  var body: some View {
    @Bindable var navigation = app.navigation
    Group {
      if app.updateRequired {
        ContentUnavailableView(
          "Update Index", systemImage: "arrow.down.app",
          description: Text("This version of Index is no longer supported. Update it from the App Store to continue."))
      } else if let message = app.configurationError {
        ContentUnavailableView(
          "Configuration needed", systemImage: "gear", description: Text(message))
      } else if app.restoring {
        ProgressView().task { await app.restore() }
      } else if let pending = app.verificationUser {
        VerificationView(email: pending.email)
      } else if app.profile == nil {
        LoginView()
      } else {
        NavigationStack(path: $navigation.path) {
          Group {
            switch app.navigation.tab {
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
        .id(app.session.generation)
        .safeAreaInset(edge: .bottom, spacing: 0) {
          if app.showsTabs {
            HStack(spacing: 0) {
              ForEach(AppTab.allCases, id: \.self) { tab in
                Button {
                  app.navigation.path = []
                  app.navigation.tab = tab
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
        .sheet(item: $navigation.sheet) { destination in
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
    .onChange(of: app.navigation.path) { _, _ in
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
    case .edit(let link): EditLinkView(link: link)
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
