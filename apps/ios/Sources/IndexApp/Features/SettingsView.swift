import IndexCore
import SwiftUI
#if os(iOS)
  import UIKit
#endif

/// One page of titled groups, like the iOS Settings app.
struct SettingsView: View {
  @Environment(AppModel.self) private var app
  @State private var editingProfile = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        PageHeading(title: "Settings")
        if let profile = app.profile {
          SettingsGroup {
            HStack(spacing: 12) {
              PersonAvatar(person: profile.person, size: 44)
              VStack(alignment: .leading, spacing: 2) {
                Text(profile.name).font(IndexFont.serif(20))
                if let username = profile.username {
                  Text(username).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
                }
              }.frame(maxWidth: .infinity, alignment: .leading)
              Button("Edit profile") { editingProfile = true }.buttonStyle(PillStyle(compact: true))
            }.padding(.vertical, 3).settingsRow()
          }
        }
        SettingsGroup(title: "Account") {
          if let profile = app.profile { ProfileVisibilitySettings(profile: profile) }
          AccountSecurityView()
        }
        SettingsGroup(title: "Notifications", footer: "Your in-app activity is always kept. No notification emails are sent.") {
          NotificationSettings()
        }
        SettingsGroup(title: "This \(thisDeviceName)", note: "Saved on this \(thisDeviceName) only") {
          AppearanceSettings()
          #if os(iOS)
            AppIconSettings()
          #endif
        }
        SettingsGroup(title: "Groups", footer: "Lock a group to keep its links to yourself.") {
          GroupSettingsView()
        }
        SettingsGroup {
          AsyncButton { await app.signOut() } label: {
            Text("Sign out").font(IndexFont.sans(14, weight: .medium)).frame(maxWidth: .infinity)
              .settingsRow().contentShape(Rectangle())
          }.buttonStyle(.plain)
        }
      }.padding(.bottom, 20)
    }.indexPage()
      .task {
        guard let store = app.store, let api = app.api else { return }
        let generation = app.session.generation
        do {
          try await store.show("settings-profile", path: "/me/profile", stable: true) {
            let profile: Profile = try await api.request("/me/profile")
            try Task.checkCancellation()
            guard generation == app.session.generation else { throw CancellationError() }
            app.profile = profile
          }
        } catch { app.handleSessionError(error) }
      }
      .sheet(isPresented: $editingProfile) {
        if let profile = app.profile { EditProfileView(profile: profile).indexSheetStyle().presentationDetents([.medium, .large]) }
      }
  }
}

/// What Settings calls the device it runs on, as in "Alerts on this phone".
@MainActor var thisDeviceName: String {
  #if os(iOS)
    UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "phone"
  #else
    "Mac"
  #endif
}

/// A setting's label on the left and its control on the right.
struct SettingsRow<Label: View, Control: View>: View {
  @ViewBuilder var label: Label
  @ViewBuilder var control: Control
  var body: some View {
    HStack(spacing: 12) {
      label.frame(maxWidth: .infinity, alignment: .leading)
      // Controls may reach into the row's padding, so a 44-point touch target doesn't make
      // the row taller.
      control.fixedSize().padding(.vertical, -9)
    }.settingsRow()
  }
}

extension SettingsRow where Label == SettingsLabel {
  init(_ title: String, description: String? = nil, @ViewBuilder control: () -> Control) {
    self.init(label: { SettingsLabel(title: title, description: description) }, control: control)
  }
}

struct SettingsLabel: View {
  let title: String
  var description: String? = nil
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title).font(IndexFont.sans(14))
      if let description {
        Text(description).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
      }
    }
  }
}
