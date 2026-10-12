import IndexCore
import IndexFeatures
import SwiftUI

struct AddLinkView: View {
  let week: String
  let groupID: String?
  let editing: SavedLink?
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var url = ""
  @State private var title = ""
  @State private var description = ""
  @State private var selectedGroup = ""
  @State private var groups: [LinkGroup] = []
  @State private var initialized = false
  @FocusState private var focused: Bool
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        PageHeading(title: editing == nil ? "Add link" : "Edit link")
        FormLabel(title: "Link")
        TextField("URL", text: $url).ghostInput().focused($focused)
          #if os(iOS)
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          #endif
        FormLabel(title: "Title")
        TextField("Title", text: $title).ghostInput()
        FormLabel(title: "Note")
        TextField("Why it caught your eye (optional)", text: $description, axis: .vertical).lineLimit(1...8)
          .ghostInput()
        FormLabel(title: "Group")
        HStack {
          Picker("Group", selection: $selectedGroup) {
            Text("No group").tag("")
            ForEach(groups.filter { $0.kind == "custom" }) { Text($0.name).tag($0.id) }
          }.labelsHidden()
          Spacer()
        }
        Text(
          selectedGroup.isEmpty
            ? "Visible to everyone who can see your profile."
            : "Visibility follows the selected group and your profile."
        ).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
        AsyncButton(action: save) {
          Text(editing == nil ? "Add" : "Save changes").frame(maxWidth: .infinity)
        }
        .buttonStyle(PillStyle(selected: true)).disabled(
          title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !validURL)
      }.padding(.bottom, 30)
    }.indexPage().scrollDismissesKeyboard(.interactively)
      .task {
        if !initialized {
          url = editing?.url ?? ""
          title = editing?.title ?? ""
          description = editing?.description ?? ""
          selectedGroup = editing?.groupId ?? groupID ?? ""
          initialized = true
          focused = true
        }
        do { groups = try await allGroups(api: app.api, ownerID: app.userID) } catch {
          app.handle(error)
        }
      }
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
      "description": .string(description),
      "groupId": selectedGroup.isEmpty ? .null : .string(selectedGroup),
    ]
    let _: SavedLink? = try await app.api?.request(
      editing.map { "/links/\($0.id)" } ?? "/links", method: editing == nil ? "POST" : "PATCH",
      body: body)
    app.changed()
    dismiss()
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
          HStack(spacing: 12) {
            if !isSheet { BackButton() }
            if let author {
              Button { app.navigate(.profile(author.id)) } label: {
                HStack(spacing: 12) {
                  PersonAvatar(person: author.person, size: 30)
                  Text(author.username ?? author.name).font(IndexFont.sans(13, weight: .medium))
                }
              }.buttonStyle(.plain)
            }
            Text(relativeTime(link.createdAt)).font(IndexFont.sans(11)).foregroundStyle(IndexPalette.subtleForeground)
            Spacer(minLength: 0)
            if isSheet { SheetCloseButton() }
          }.padding(.bottom, 8)
          Text(link.title).font(IndexFont.sans(32, weight: .semibold, relativeTo: .title))
            .tracking(-1.12).textSelection(.enabled).accessibilityAddTraits(.isHeader)
          HStack {
            if let url = URL(string: link.url) {
              Link(destination: url) { Label(link.domain, systemImage: "arrow.up.right") }
                .foregroundStyle(IndexPalette.subtleForeground)
            }
            Spacer()
            LinkActions(link: link)
          }
          if let description = link.description, !description.isEmpty {
            Text(description).foregroundStyle(IndexPalette.subtleForeground)
          }
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
        if let page = try await firstComments {
          comments = page.items
          cursor = page.nextCursor
        }
        author = try await profile
      }
    } catch is CancellationError { return } catch {
      if case APIError.server(let status, _) = error, [403, 404].contains(status) {
        link = nil
        author = nil
        comments = []
      }
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
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

private struct FormLabel: View {
  let title: String
  var body: some View {
    Text(title.uppercased()).font(IndexFont.mono(11)).tracking(0.66)
      .foregroundStyle(IndexPalette.subtleForeground).padding(.bottom, -14)
  }
}
