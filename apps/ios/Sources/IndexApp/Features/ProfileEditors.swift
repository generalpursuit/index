import IndexCore
import SwiftUI

struct SettingsView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var username = ""
  @State private var initialized = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        PageHeading(title: "Settings")
        TextField("Name", text: $name).ghostInput()
        TextField("Username", text: $username).ghostInput()
          #if os(iOS)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
          #endif
        AsyncButton {
          // Photos are uploaded (POST /me/image), never set as an address.
          var body: [String: JSONValue] = ["name": .string(name)]
          if !username.isEmpty { body["username"] = .string(username.lowercased()) }
          app.profile = try await app.api?.request("/me/profile", method: "PATCH", body: body)
          app.changed()
          dismiss()
        } label: {
          Text("Save changes").frame(maxWidth: .infinity)
        }.buttonStyle(PillStyle(selected: true)).disabled(
          name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Divider().padding(.vertical)
        GroupSettingsView()
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
      initialized = true
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
