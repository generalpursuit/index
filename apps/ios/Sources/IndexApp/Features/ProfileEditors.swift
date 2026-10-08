import IndexCore
import SwiftUI

struct EditProfileView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var username = ""
  @State private var bio = ""
  @State private var imageURL = ""
  @State private var initialized = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        PageHeading(title: "Edit profile")
        TextField("Name", text: $name).ghostInput()
        TextField("Username", text: $username).ghostInput()
          #if os(iOS)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
          #endif
        TextField("Bio", text: $bio, axis: .vertical).lineLimit(3...6).ghostInput()
        TextField("Avatar image URL (optional)", text: $imageURL).ghostInput()
          #if os(iOS)
            .textInputAutocapitalization(.never).keyboardType(.URL)
          #endif
        AsyncButton {
          var body: [String: JSONValue] = [
            "name": .string(name), "bio": .string(bio),
            "image": imageURL.isEmpty ? .null : .string(imageURL),
          ]
          if !username.isEmpty { body["username"] = .string(username.lowercased()) }
          app.profile = try await app.api?.request("/me/profile", method: "PATCH", body: body)
          app.changed()
          dismiss()
        } label: {
          Text("Save changes").frame(maxWidth: .infinity)
        }.buttonStyle(PillStyle(selected: true)).disabled(
          name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Divider().padding(.vertical)
        AsyncButton {
          await app.signOut()
        } label: {
          Text("Sign out")
        }.buttonStyle(PillStyle())
      }
    }.indexPage().task {
      guard !initialized, let profile = app.profile else { return }
      name = profile.name
      username = profile.username ?? ""
      bio = profile.bio ?? ""
      imageURL = profile.image ?? ""
      initialized = true
    }
  }
}
struct GroupEditorView: View {
  let group: LinkGroup?
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var locked = false
  @State private var deleting = false
  @State private var initialized = false
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      PageHeading(title: group == nil ? "New group" : "Edit group")
      TextField("Group name", text: $name).ghostInput()
      Toggle(isOn: $locked) { Label("Locked", systemImage: locked ? "lock" : "lock.open") }
      Text(
        locked ? "Only you can see links in this group." : "Links follow your profile’s visibility."
      ).font(.subheadline).foregroundStyle(.secondary)
      AsyncButton {
        let _: LinkGroup? = try await app.api?.request(
          group.map { "/groups/\($0.id)" } ?? "/groups", method: group == nil ? "POST" : "PATCH",
          body: ["name": .string(name), "visibility": .string(locked ? "private" : "public")])
        app.changed()
        dismiss()
      } label: {
        Text(group == nil ? "Create" : "Save changes").frame(maxWidth: .infinity)
      }.buttonStyle(PillStyle(selected: true)).disabled(
        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      if group != nil {
        Button("Delete group", role: .destructive) { deleting = true }.buttonStyle(PillStyle())
      }
      Spacer()
    }.indexPage().task {
      if !initialized {
        name = group?.name ?? ""
        locked = group?.visibility == .private
        initialized = true
      }
    }
    .confirmationDialog(
      "Delete group? Its links will move to your locked Inbox.", isPresented: $deleting,
      titleVisibility: .visible
    ) {
      Button("Delete group", role: .destructive) {
        guard let group else { return }
        Task {
          do {
            let _: Success? = try await app.api?.request(
              "/groups/\(group.id)", method: "DELETE", body: ["deleteLinks": .bool(false)])
            app.changed()
            dismiss()
          } catch { app.handle(error) }
        }
      }
    }
  }
}
struct ConnectionsView: View {
  let initial: String
  @Environment(AppModel.self) private var app
  @State private var kind = "followers"
  @State private var people: [Person] = []
  @State private var after: String?
  @State private var error: String?
  @State private var initialized = false
  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        PageHeading(title: "Your people")
        Picker("Connections", selection: $kind) {
          Text("Followers").tag("followers")
          Text("Following").tag("following")
        }.pickerStyle(.segmented)
        LoadingError(error: error, loading: false, retry: { await load() })
        ForEach(people) { person in
          HStack {
            Button {
              app.path.append(.profile(person.id))
            } label: {
              PersonRow(person: person)
            }.buttonStyle(.plain)
            AsyncButton {
              let path =
                kind == "followers" ? "/me/followers/\(person.id)" : "/profiles/\(person.id)/follow"
              let _: Success? = try await app.api?.request(path, method: "DELETE")
              people.removeAll { $0.id == person.id }
              app.changed()
            } label: {
              Text(kind == "followers" ? "Remove" : "Unfollow")
            }.buttonStyle(PillStyle())
          }
        }
        if people.isEmpty && error == nil {
          Text(kind == "followers" ? "No followers yet." : "You’re not following anyone yet.")
            .foregroundStyle(.secondary).padding()
        }
        LoadMore(hasMore: after != nil) { await load(more: true) }
      }
    }.indexPage().task {
      if !initialized {
        kind = initial
        initialized = true
      }
      await load()
    }.task(id: kind) { if initialized { await load() } }
  }
  private func load(more: Bool = false) async {
    var query = ["limit": "30"]
    if more { query["after"] = after }
    do {
      if let page: PeoplePage = try await app.api?.request(
        "/profiles/\(app.userID)/\(kind)", query: query)
      {
        people = more ? people + page.items : page.items
        after = page.nextAfter
        error = nil
      }
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
  }
}
