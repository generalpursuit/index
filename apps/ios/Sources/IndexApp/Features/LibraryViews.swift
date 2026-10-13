import IndexCore
import IndexFeatures
import SwiftUI

/// Edits a saved link laid out like the post itself, and deletes it. Links are added from the
/// week's field, so this is the only form for a link.
struct EditLinkView: View {
  let link: SavedLink
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var url = ""
  @State private var title = ""
  @State private var note = ""
  @State private var groupID = ""
  @State private var groups: [LinkGroup] = []
  @State private var initialized = false
  @State private var deleting = false
  @FocusState private var focus: Focus?
  private enum Focus { case title, url, note }
  private var customGroups: [LinkGroup] { groups.filter { $0.kind == "custom" } }
  private var chosen: LinkGroup? { customGroups.first { $0.id == groupID } }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack {
          Text("EDIT LINK").font(IndexFont.mono(11)).tracking(0.66)
            .foregroundStyle(IndexPalette.subtleForeground).accessibilityLabel("Edit link")
            .accessibilityAddTraits(.isHeader)
          Spacer()
          SheetCloseButton()
        }
        HStack(spacing: 8) {
          if link.category != .uncategorized {
            CategoryMark(category: link.category)
            Text(link.category.rawValue.uppercased())
            Text("·").accessibilityHidden(true)
          }
          groupMenu
        }.font(IndexFont.mono(11)).tracking(0.66).foregroundStyle(IndexPalette.subtleForeground)
          .padding(.top, 8)
        TextField("Title", text: $title, axis: .vertical).font(IndexFont.serif(30)).tracking(-0.45)
          .lineLimit(1...4).focused($focus, equals: .title).submitLabel(.done)
          .padding(.top, 16)
          // A title is one line; Return ends editing instead of starting another.
          .onChange(of: title) { _, value in
            guard value.contains("\n") else { return }
            title = value.replacingOccurrences(of: "\n", with: " ")
            focus = nil
          }
        HStack(spacing: 8) {
          Image(systemName: "globe").font(.system(size: 13)).foregroundStyle(IndexPalette.subtleForeground)
          TextField("Link", text: $url).font(IndexFont.mono(14)).focused($focus, equals: .url)
            .foregroundStyle(IndexPalette.mutedForeground)
            #if os(iOS)
              .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            #endif
        }.padding(.horizontal, 12).frame(minHeight: 44)
          .overlay(RoundedRectangle(cornerRadius: 10).stroke(
            focus == .url ? IndexPalette.foreground : IndexPalette.border,
            style: StrokeStyle(lineWidth: 1, dash: focus == .url ? [] : [4, 3])))
          .padding(.top, 12)
        TextField("Anything worth remembering?", text: $note, axis: .vertical).lineLimit(2...8)
          .font(IndexFont.sans(16)).focused($focus, equals: .note).padding(.leading, 14)
          .padding(.vertical, 4)
          .overlay(alignment: .leading) {
            Rectangle().fill(focus == .note ? IndexPalette.foreground : IndexPalette.border).frame(width: 2)
          }
          .padding(.top, 20)
        HStack(spacing: 8) {
          Image(systemName: chosen?.visibility == .private ? "lock" : "globe").font(.system(size: 12))
          Text(
            chosen?.visibility == .private
              ? "Only you will see this link." : "Visible to everyone who can see your profile.")
        }.font(IndexFont.sans(13)).foregroundStyle(IndexPalette.subtleForeground).padding(.top, 16)
        Divider().padding(.top, 24)
        HStack {
          Button("Delete link", role: .destructive) { deleting = true }
            .font(IndexFont.sans(13, weight: .medium)).foregroundStyle(IndexPalette.destructive)
            .frame(minHeight: 44)
          Spacer()
          AsyncButton(action: save) { Text("Save changes") }
            .buttonStyle(PillStyle(selected: true))
            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !validURL)
        }.padding(.top, 16)
      }.padding(.bottom, 30)
    }.indexPage().scrollDismissesKeyboard(.interactively)
      .confirmationDialog("Delete link?", isPresented: $deleting, titleVisibility: .visible) {
        Button("Delete", role: .destructive) { Task { await delete() } }
      } message: {
        Text("This removes the original post, its comments, and saved references.")
      }
      .task {
        if !initialized {
          url = link.url
          title = link.title
          note = link.description ?? ""
          groupID = link.groupId ?? ""
          initialized = true
        }
        do { groups = try await allGroups(api: app.api, ownerID: app.userID) } catch {
          app.handle(error)
        }
      }
  }
  /// Your groups, and who will see the link in each; "No group" follows your profile.
  private var groupMenu: some View {
    // Until the groups load, a chosen group may not be known by name yet.
    let name = chosen?.name ?? (groupID.isEmpty ? "No group" : "Group")
    return Menu {
      Picker("Group", selection: $groupID) {
        Text("No group").tag("")
        ForEach(customGroups) { group in
          if group.visibility == .private {
            Label(group.name, systemImage: "lock").tag(group.id)
          } else {
            Text(group.name).tag(group.id)
          }
        }
      }
    } label: {
      HStack(spacing: 5) {
        if chosen?.visibility == .private { Image(systemName: "lock").font(.system(size: 10)) }
        Text(name.uppercased()).lineLimit(1)
        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
          .foregroundStyle(IndexPalette.subtleForeground)
      }.foregroundStyle(IndexPalette.foreground).padding(.horizontal, 8).frame(minHeight: 28)
        .background(IndexPalette.card, in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(IndexPalette.border, lineWidth: 1))
    }.menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Group: \(name)")
  }
  private var validURL: Bool {
    guard let value = URL(string: url.trimmingCharacters(in: .whitespacesAndNewlines)) else {
      return false
    }
    return ["http", "https"].contains(value.scheme) && value.host != nil
  }
  private func save() async throws {
    let body: [String: JSONValue] = [
      "url": .string(url.trimmingCharacters(in: .whitespacesAndNewlines)), "title": .string(title),
      "description": .string(note),
      "groupId": groupID.isEmpty ? .null : .string(groupID),
    ]
    let _: SavedLink? = try await app.api?.request("/links/\(link.id)", method: "PATCH", body: body)
    app.changed()
    dismiss()
  }
  private func delete() async {
    do {
      let _: Success? = try await app.api?.request("/links/\(link.id)", method: "DELETE")
      app.navigation.sheet = nil
      // The link's own page has nothing left to show.
      if app.navigation.path.last == .link(link.id) { app.navigation.path.removeLast() }
      app.changed()
    } catch { app.handle(error) }
  }
}

@MainActor
func allGroups(api: APIClient?, ownerID: String) async throws -> [LinkGroup] {
  guard let api else { return [] }
  return try await loadGroups(api: api, ownerID: ownerID)
}

struct LinkDetailView: View {
  let linkID: String
  @Environment(AppModel.self) private var app
  @State private var link: SavedLink?
  @State private var author: Profile?
  @State private var group: LinkGroup?
  @State private var comments: [Comment] = []
  @State private var cursor: String?
  @State private var bodyText = ""
  @State private var replying: Person?
  @State private var error: String?
  @State private var loading = true
  @State private var deleting: Comment?
  @FocusState private var focus: Bool
  @Environment(\.indexSheet) private var isSheet
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        LoadingError(error: error, loading: loading, retry: { await load() })
        if let link {
          HStack(spacing: 8) {
            if !isSheet { BackButton() }
            LinkLabel(link: link, group: group)
            Spacer(minLength: 0)
            if isSheet { SheetCloseButton() }
          }
          VStack(alignment: .leading, spacing: 12) {
            Text(link.title).font(IndexFont.serif(32)).tracking(-0.48).textSelection(.enabled)
              .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
              if let author {
                Button { app.navigate(.profile(author.id)) } label: {
                  HStack(spacing: 8) {
                    PersonAvatar(person: author.person, size: 22)
                    Text(author.username ?? author.name).font(IndexFont.sans(13, weight: .medium))
                      .foregroundStyle(IndexPalette.foreground)
                  }
                }.buttonStyle(.plain)
                Text("·").accessibilityHidden(true)
              }
              Text(relativeTime(link.createdAt))
            }.font(IndexFont.sans(13)).foregroundStyle(IndexPalette.subtleForeground)
          }
          if let description = link.description, !description.isEmpty {
            Text(description).font(IndexFont.sans(16)).textSelection(.enabled).padding(.leading, 14)
              .overlay(alignment: .leading) { Rectangle().fill(IndexPalette.border).frame(width: 2) }
          }
          LinkActions(link: link, group: group)
          Divider()
          Text("Comments").font(IndexFont.sans(16, weight: .medium))
          ForEach(comments) { comment in
            HStack(alignment: .top, spacing: 10) {
              if let person = comment.author {
                Button {
                  app.navigate(.profile(person.id))
                } label: {
                  PersonAvatar(person: person, size: 32)
                }.buttonStyle(.plain)
              }
              VStack(alignment: .leading, spacing: 6) {
                HStack {
                  Text(comment.author?.label ?? "You").font(IndexFont.sans(12)).bold()
                  Text(relativeTime(comment.createdAt)).font(IndexFont.sans(11)).foregroundStyle(IndexPalette.subtleForeground)
                }
                Text(comment.body).font(IndexFont.sans(14))
              }.frame(maxWidth: .infinity, alignment: .leading)
              Menu {
                Button("Respond", systemImage: "arrowshape.turn.up.left") {
                  replying = comment.author
                  focus = true
                }
                if comment.authorId == app.userID {
                  Button("Delete", systemImage: "trash", role: .destructive) { deleting = comment }
                }
              } label: {
                Image(systemName: "ellipsis").frame(width: 44, height: 32)
              }.menuStyle(.borderlessButton).fixedSize()
            }
          }
          if comments.isEmpty { Text("Start the conversation.").foregroundStyle(IndexPalette.subtleForeground) }
          LoadMore(hasMore: cursor != nil) { try await loadComments(more: true) }
        }
      }.padding(.bottom, 20)
    }.indexPage()
      .safeAreaInset(edge: .bottom) {
        if link != nil {
          VStack(alignment: .leading, spacing: 8) {
            if let replying {
              HStack {
                Text("Responding to @\(replying.label)").font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
                Spacer()
                Button("Cancel") { self.replying = nil }
              }
            }
            HStack {
              TextField("Comment", text: $bodyText, axis: .vertical).lineLimit(1...5).focused(
                $focus
              ).font(IndexFont.sans(16)).padding(.horizontal, 14).padding(.vertical, 10)
                .overlay(Capsule().stroke(IndexPalette.border, lineWidth: 1))
              AsyncButton {
                let text = (replying.map { "@\($0.label) " } ?? "") + bodyText
                let _: Comment? = try await app.api?.request(
                  "/links/\(linkID)/comments", method: "POST", body: ["body": .string(text)])
                bodyText = ""
                replying = nil
                try await loadComments()
                app.changed()
              } label: {
                Image(systemName: "arrow.up").frame(width: 40, height: 40).background(
                  IndexPalette.muted, in: Circle())
              }
              .disabled(bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
              .accessibilityLabel("Send comment")
            }
          }.padding(20).background(isSheet ? IndexPalette.surface : IndexPalette.background)
        }
      }
      .confirmationDialog(
        "Delete this comment?",
        isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
        titleVisibility: .visible
      ) {
        Button("Delete", role: .destructive) {
          guard let comment = deleting else { return }
          Task {
            do {
              let _: Success? = try await app.api?.request(
                "/comments/\(comment.id)", method: "DELETE")
              deleting = nil
              try await loadComments()
            } catch { app.handle(error) }
          }
        }
      }
      .task(id: app.revision) { await load() }
  }
  private func load() async {
    if link == nil {
      if app.navigation.openingLink?.id == linkID {
        link = app.navigation.openingLink
        app.navigation.openingLink = nil
      } else {
        link = await app.api?.cached("/links/\(linkID)")
      }
    }
    if let link, author == nil { author = await app.api?.cached("/profiles/\(link.ownerId)") }
    if let id = link?.groupId, group == nil { group = await app.api?.cached("/groups/\(id)") }
    if comments.isEmpty,
      let cached: Page<Comment> = await app.api?.cached(
        "/links/\(linkID)/comments", query: ["limit": "30"])
    {
      comments = cached.items
      cursor = cached.nextCursor
    }
    loading = link == nil
    error = nil
    do {
      async let firstComments: Page<Comment>? = app.api?.request(
        "/links/\(linkID)/comments", query: ["limit": "30"])
      let result: SavedLink? = try await app.api?.request("/links/\(linkID)")
      try Task.checkCancellation()
      link = result
      loading = false
      if let result {
        async let profile: Profile? = app.api?.request("/profiles/\(result.ownerId)")
        async let linkGroup = loadGroup(result.groupId)
        if let page = try await firstComments {
          comments = page.items
          cursor = page.nextCursor
        }
        author = try await profile
        // The label and forwarding need the group, but the post doesn't fail without it.
        group = try? await linkGroup
      }
    } catch is CancellationError { return } catch {
      if case APIError.server(let status, _) = error, [403, 404].contains(status) {
        link = nil
        author = nil
        group = nil
        comments = []
      }
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
  }
  private func loadGroup(_ id: String?) async throws -> LinkGroup? {
    guard let id else { return nil }
    return try await app.api?.request("/groups/\(id)")
  }
  private func loadComments(more: Bool = false) async throws {
    var query = ["limit": "30"]
    if more { query["cursor"] = cursor }
    if let page: Page<Comment> = try await app.api?.request(
      "/links/\(linkID)/comments", query: query)
    {
      comments = more ? comments + page.items : page.items
      cursor = page.nextCursor
    }
  }
}
func relativeTime(_ value: String) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  var date = formatter.date(from: value)
  if date == nil { formatter.formatOptions = [.withInternetDateTime]; date = formatter.date(from: value) }
  guard let date else { return "" }
  let minutes = max(0, Int(Date().timeIntervalSince(date) / 60))
  return minutes < 1 ? "Now" : minutes < 60 ? "\(minutes)m" : minutes < 1440 ? "\(minutes / 60)h" : "\(minutes / 1440)d"
}
