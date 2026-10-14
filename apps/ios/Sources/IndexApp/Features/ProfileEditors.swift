import IndexCore
import IndexFeatures
import SwiftUI

struct SettingsView: View {
  @Environment(AppModel.self) private var app
  @State private var editingProfile = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        PageHeading(title: "Settings").padding(.bottom, 6)
        if let profile = app.profile {
          HStack(spacing: 18) {
            PersonAvatar(person: profile.person, size: 64)
            VStack(alignment: .leading, spacing: 2) {
              Text(profile.name).font(IndexFont.serif(24))
              if let username = profile.username {
                Text(username).font(IndexFont.sans(14)).foregroundStyle(IndexPalette.subtleForeground)
              }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Button { editingProfile = true } label: {
              Image(systemName: "pencil").font(.system(size: 18)).frame(width: 44, height: 44)
            }.buttonStyle(.plain).accessibilityLabel("Edit profile")
          }.settingsBox()
          AppearanceSettings().settingsBox()
          #if os(iOS)
            AppIconSettings().settingsBox()
          #endif
          ProfileVisibilitySettings(profile: profile).settingsBox()
        }
        GroupSettingsView().settingsBox()
        NotificationSettings().settingsBox()
        AccountSecurityView().settingsBox()
        AsyncButton { await app.signOut() } label: {
          Text("Sign out").font(IndexFont.sans(14, weight: .medium)).frame(maxWidth: .infinity)
        }.buttonStyle(.plain).settingsBox()
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

private struct EditProfileView: View {
  init(profile: Profile) {
    _name = State(initialValue: profile.name)
    _username = State(initialValue: profile.username ?? "")
    _initialized = State(initialValue: true)
  }
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var username = ""
  @State private var initialized = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        PageHeading(title: "Edit profile")
        if let profile = app.profile { PersonAvatar(person: profile.person, size: 88).padding(.vertical, 6) }
        VStack(alignment: .leading, spacing: 8) {
          Text("Name").font(IndexFont.sans(13, weight: .medium))
          TextField("Name", text: $name).textContentType(.name).ghostInput()
        }
        VStack(alignment: .leading, spacing: 8) {
          Text("Username").font(IndexFont.sans(13, weight: .medium))
          TextField("Username", text: $username).textContentType(.username).ghostInput()
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
            #endif
        }
        AsyncButton {
          var body: [String: JSONValue] = ["name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines))]
          if !username.isEmpty { body["username"] = .string(username.lowercased()) }
          _ = try await app.store?.editProfile(body: body)
          dismiss()
        } label: { Text("Save changes").frame(maxWidth: .infinity) }
          .buttonStyle(PillStyle(selected: true)).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }.padding(.bottom, 20)
    }.indexPage().scrollDismissesKeyboard(.interactively)
      .task {
        guard !initialized, let profile = app.profile else { return }
        name = profile.name; username = profile.username ?? ""; initialized = true
      }
  }
}

private struct ProfileVisibilitySettings: View {
  let profile: Profile
  @Environment(AppModel.self) private var app
  @State private var selection: IndexCore.Visibility?
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Profile visibility").font(IndexFont.sans(16, weight: .medium))
        Spacer()
        Menu {
          Button("Public") { if profile.profileVisibility != .public { selection = .public } }
          Button("Private") { if profile.profileVisibility != .private { selection = .private } }
        } label: {
          HStack(spacing: 6) {
            Text(profile.profileVisibility.rawValue.capitalized)
            Image(systemName: "chevron.down").font(.system(size: 12))
          }.font(IndexFont.sans(13)).frame(minHeight: 44)
        }
      }
      Text(profile.profileVisibility == .private ? "Only approved followers can see your links." : "Anyone can see your profile and links.")
        .foregroundStyle(IndexPalette.subtleForeground)
      Text("Locked groups stay only yours.").foregroundStyle(IndexPalette.subtleForeground)
    }
    .alert(selection == .private ? "Make profile private?" : "Make profile public?",
      isPresented: Binding(get: { selection != nil }, set: { if !$0 { selection = nil } })) {
        Button("Cancel", role: .cancel) { selection = nil }
        Button("Confirm") {
          guard let selection else { return }
          Task {
            do {
              _ = try await app.store?.editProfile(body: ["profileVisibility": .string(selection.rawValue)])
              self.selection = nil
            } catch { app.handle(error) }
          }
        }
      } message: {
        Text(selection == .private
          ? "Only approved followers can see your links. Existing followers keep access. Locked groups stay only yours."
          : "Anyone can see your links. Pending requests will be accepted. Locked groups stay only yours.")
      }
  }
}
struct ConnectionsView: View {
  let initial: String
  @Environment(AppModel.self) private var app
  @Environment(AccountStore.self) private var store
  @State private var kind: String
  private var model: ConnectionsModel { store.connections(kind) }
  private var people: [Person] { !model.hasLoaded && model.error == nil ? (0..<5).map(ContentPlaceholder.person) : model.people }
  private var after: String? { model.after }
  private var error: String? { model.error }
  init(initial: String) { self.initial = initial; _kind = State(initialValue: initial) }
  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        PageHeading(title: "Your people")
        HStack(spacing: 8) {
          ForEach(["followers", "following"], id: \.self) { value in
            Button(value.capitalized) { kind = value }
              .buttonStyle(PillStyle(selected: kind == value, compact: true))
              .accessibilityAddTraits(kind == value ? .isSelected : [])
          }
          Spacer()
        }
        RequestError(error: error, retry: { await load() })
        Group {
          ForEach(people) { person in
            HStack {
              Button {
                app.openProfile(person)
              } label: {
                PersonRow(person: person)
              }.buttonStyle(.plain)
              AsyncButton {
                guard let api = app.api else { return }
                try await model.remove(person, kind: kind, api: api)
              } label: {
                Text(kind == "followers" ? "Remove" : "Unfollow")
              }.buttonStyle(PillStyle())
            }
          }
        }.calmPlaceholder(active: !model.hasLoaded && error == nil)
        if model.hasLoaded && people.isEmpty && error == nil {
          Text(kind == "followers" ? "No followers yet." : "You’re not following anyone yet.")
            .foregroundStyle(IndexPalette.subtleForeground).padding()
        }
        LoadMore(hasMore: after != nil) { await load(more: true) }
      }
    }.indexPage().task(id: kind) { await load() }
  }
  private func load(more: Bool = false) async {
    guard let api = app.api else { return }
    do {
      try await store.show("connections:" + kind, path: "/profiles/\(app.userID)/\(kind)", query: ["limit": "30"], force: more || error != nil) {
        try await model.load(api: api, account: app.userID, kind: kind, more: more)
      }
    } catch { app.handleSessionError(error) }
  }
}
