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

/// A titled container of rows. Each row is laid out with `settingsRow()`.
struct SettingsGroup<Content: View>: View {
  var title: String? = nil
  /// Follows the title, for example where the settings are saved.
  var note: String? = nil
  var footer: String? = nil
  @ViewBuilder var content: Content
  var body: some View {
    let shape = RoundedRectangle(cornerRadius: 16)
    VStack(alignment: .leading, spacing: 7) {
      if let title {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(title).font(IndexFont.mono(11)).tracking(0.77).textCase(.uppercase)
            .foregroundStyle(IndexPalette.subtleForeground)
          if let note {
            Text(note).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground.opacity(0.75))
          }
        }.padding(.horizontal, 4)
          .accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
      }
      VStack(spacing: 0) { content }
        // Every row draws a hairline above itself. The first one lies outside the clip, so only
        // rows that follow another row are separated; iOS 17 can't enumerate the rows instead.
        .padding(.top, -1)
        .clipShape(shape)
        .overlay(shape.strokeBorder(IndexPalette.border, lineWidth: 1))
      if let footer {
        Text(footer).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
          .padding(.horizontal, 4)
      }
    }
  }
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

extension View {
  /// Lays out content as a row of a `SettingsGroup`, below a hairline.
  func settingsRow() -> some View {
    padding(.horizontal, 16).padding(.vertical, 9)
      .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
      .overlay(alignment: .top) { Rectangle().fill(IndexPalette.border).frame(height: 1) }
  }
}
