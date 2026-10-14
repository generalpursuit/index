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
        SessionPlaceholder()
      } else if let pending = app.verificationUser {
        VerificationView(email: pending.email)
      } else if app.profile == nil {
        LoginView()
      } else if let store = app.store {
        NavigationStack(path: $navigation.path) {
          AccountTabs()
          .hideNativeNavigation()
          .navigationDestination(for: Destination.self) { destination in
            destinationView(destination).hideNativeNavigation()
          }
          .background(IndexPalette.background)
        }
        .environment(store)
        .environment(\.screenVisible, app.sessionReady)
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
          destinationView(destination).environment(store).id(destination).indexSheetStyle()
            .presentationDetents(sheetDetents(destination))
        }
        .task(id: "\(scenePhase)-\(app.dataBudget.constrained)-\(app.sessionReady)") {
          guard app.sessionReady, scenePhase == .active, !app.dataBudget.constrained, !ProcessInfo.processInfo.isLowPowerModeEnabled else { return }
          do { try await Task.sleep(for: .seconds(1)) } catch { return }
          await store.warm()
        }
        .task(id: "\(store.openConversationID ?? "")-\(app.navigation.sheet == nil)-\(app.sessionReady)") {
          store.conversationFocused = app.navigation.sheet == nil
          await NotificationController.shared.setActive(app: app, foreground: scenePhase == .active)
          guard app.sessionReady, scenePhase == .active, store.conversationFocused, let id = store.openConversationID else { return }
          do { try await store.refreshConversation(id) } catch { app.handleSessionError(error) }
        }
        .task(id: "\(scenePhase)-\(app.sessionReady)") {
          store.active = scenePhase == .active
          guard store.active, app.sessionReady else { return }
          await app.refreshPulse()
          var lastPulse = ContinuousClock.now
          while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
            if ContinuousClock.now - lastPulse >= store.pulseInterval {
              await app.refreshPulse()
              lastPulse = .now
            }
          }
        }
      }
    }
    .task { await app.restore() }
    .frame(maxWidth: .infinity, maxHeight: .infinity).background(IndexPalette.background)
    .overlay(alignment: .bottom) { SavedLinkToast().padding(.bottom, 80) }
    .overlay(alignment: .bottom) {
      if let error = app.sessionError {
        HStack(spacing: 12) {
          Text(error).font(IndexFont.sans(12))
          Button("Try again") { Task { await app.restore() } }.buttonStyle(PillStyle(compact: true))
        }.padding(12).background(IndexPalette.surface, in: RoundedRectangle(cornerRadius: 12))
          .padding(.horizontal, 20).padding(.bottom, 80)
      }
    }
    .onAppear { NotificationController.shared.attach(app) }
    .onChange(of: app.restoring) { _, restoring in
      if !restoring { NotificationController.shared.attach(app) }
    }
    .onChange(of: app.verifiedSessionRevision, initial: true) { _, _ in
      if app.sessionReady {
        NotificationController.shared.attach(app)
        app.resumeReadableURL()
        Task { await NotificationController.shared.synchronize(app) }
      }
    }
    .onChange(of: scenePhase) { _, phase in
      app.store?.active = phase == .active
      Task {
        if phase == .active {
          if app.session.provisional { await app.restore() }
          await NotificationController.shared.synchronize(app)
        }
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

private struct ScreenVisibleKey: EnvironmentKey {
  static let defaultValue = true
}
extension EnvironmentValues {
  var screenVisible: Bool {
    get { self[ScreenVisibleKey.self] }
    set { self[ScreenVisibleKey.self] = newValue }
  }
}
private struct AccountTabs: View {
  @Environment(AppModel.self) private var app
  var body: some View {
    ZStack {
      ForEach(AppTab.allCases, id: \.self) { tab in
        MountedTabRoot(tab: tab, selected: app.navigation.tab == tab)
      }
    }
  }
}
private struct MountedTabRoot: View {
  let tab: AppTab
  let selected: Bool
  @Environment(AppModel.self) private var app
  @State private var visited: Bool
  init(tab: AppTab, selected: Bool) {
    self.tab = tab
    self.selected = selected
    _visited = State(initialValue: selected)
  }
  var body: some View {
    Group {
      if visited {
        Group {
          switch tab {
          case .feed: FeedView()
          case .discover: DiscoverView()
          case .activity: ActivityView()
          case .messages: MessagesView()
          case .profile: ProfileView(userID: app.userID)
          }
        }
      } else { Color.clear }
    }
    .environment(\.screenVisible, selected && app.navigation.path.isEmpty && app.sessionReady)
    .opacity(selected ? 1 : 0)
    .allowsHitTesting(selected)
    .accessibilityHidden(!selected)
    .onChange(of: selected) { _, selected in if selected { visited = true } }
  }
}

private struct SessionPlaceholder: View {
  var body: some View {
    GeometryReader { _ in
      VStack(alignment: .leading, spacing: 20) {
        Text(Week.label(Week.monday())).font(IndexFont.serif(44, relativeTo: .largeTitle)).tracking(-0.66)
        VStack(spacing: 0) {
          ForEach(0..<5, id: \.self) { LinkRow(link: ContentPlaceholder.link($0)) }
        }.calmPlaceholder(active: true)
        Spacer()
      }.padding(.top, 40).padding(.leading, 20).padding(.trailing, 36)
        .safeAreaInset(edge: .bottom, spacing: 0) {
          HStack(spacing: 0) {
            ForEach(AppTab.allCases, id: \.self) { tab in
              NavigationIcon(tab: tab).frame(width: 44, height: 44).frame(maxWidth: .infinity)
            }
          }.padding(.horizontal, 8).frame(height: 66).foregroundStyle(IndexPalette.subtleForeground)
            .accessibilityHidden(true)
        }
    }
  }
}
