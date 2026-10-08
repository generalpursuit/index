import IndexCore
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
  @State private var category = Category.uncategorized
  @State private var selectedGroup = ""
  @State private var savedOn = Date()
  @State private var groups: [LinkGroup] = []
  @State private var initialized = false
  @FocusState private var focused: Bool
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        PageHeading(title: editing == nil ? "Add link" : "Edit link")
        Text(Week.label(week)).font(.caption).foregroundStyle(.secondary)
        TextField("URL", text: $url).ghostInput().focused($focused)
          #if os(iOS)
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          #endif
        TextField("Title", text: $title).font(.title2).ghostInput()
        TextField("Description (optional)", text: $description, axis: .vertical).lineLimit(4...8)
          .ghostInput()
        HStack {
          Picker("Category", selection: $category) {
            ForEach(Category.allCases, id: \.self) {
              Text($0 == .uncategorized ? "Category" : $0.rawValue.capitalized).tag($0)
            }
          }.labelsHidden()
          Picker("Group", selection: $selectedGroup) {
            Text("Inbox").tag("")
            ForEach(groups.filter { $0.kind == "custom" }) { Text($0.name).tag($0.id) }
          }.labelsHidden()
          Spacer()
        }
        DatePicker("Saved on", selection: $savedOn, in: ...Date(), displayedComponents: .date)
          .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
        Text(
          selectedGroup.isEmpty
            ? "Inbox is locked. Only you can see these links."
            : "Visibility follows the selected group and your profile."
        ).font(.caption).foregroundStyle(.secondary)
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
          category = editing?.category ?? .uncategorized
          selectedGroup = editing?.groupId ?? groupID ?? ""
          savedOn =
            editing.map { Week.date($0.savedOn) }
            ?? (week == Week.monday() ? Date() : Week.date(week))
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
      "description": .string(description), "category": .string(category.rawValue),
      "groupId": selectedGroup.isEmpty ? .null : .string(selectedGroup),
      "savedOn": .string(Week.dateString(savedOn)),
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
  var groups: [LinkGroup] = []
  var cursor: String?
  repeat {
    var query = ["ownerId": ownerID, "includeFavorites": "true", "limit": "100"]
    query["cursor"] = cursor
    guard let page: Page<LinkGroup> = try await api?.request("/groups", query: query) else {
      return []
    }
    groups += page.items
    cursor = page.nextCursor
  } while cursor != nil
  return groups
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
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        LoadingError(error: error, loading: loading, retry: { await load() })
        if let link {
          if let author {
            Button {
              app.path.append(.profile(author.id))
            } label: {
              PersonRow(person: author.person)
            }.buttonStyle(.plain)
          }
          Text(link.title).font(.system(size: 34, weight: .semibold, design: .serif))
          HStack {
            if let url = URL(string: link.url) {
              Link(destination: url) { Label(link.domain, systemImage: "arrow.up.right") }
                .foregroundStyle(.secondary)
            }
            Spacer()
            LinkMenu(link: link)
          }
          if let description = link.description, !description.isEmpty {
            Text(description).foregroundStyle(.secondary)
          }
          Divider()
          Text("Comments").font(.headline)
          ForEach(comments) { comment in
            HStack(alignment: .top, spacing: 10) {
              if let person = comment.author {
                Button {
                  app.path.append(.profile(person.id))
                } label: {
                  PersonAvatar(person: person, size: 32)
                }.buttonStyle(.plain)
              }
              VStack(alignment: .leading, spacing: 6) {
                HStack {
                  Text(comment.author?.label ?? "You").font(.caption).bold()
                  Text(relativeTime(comment.createdAt)).font(.caption2).foregroundStyle(.secondary)
                }
                Text(comment.body).font(.subheadline)
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
          if comments.isEmpty { Text("Start the conversation.").foregroundStyle(.secondary) }
          LoadMore(hasMore: cursor != nil) { try await loadComments(more: true) }
        }
      }.padding(.bottom, 20)
    }.indexPage()
      .safeAreaInset(edge: .bottom) {
        if link != nil {
          VStack(alignment: .leading, spacing: 8) {
            if let replying {
              HStack {
                Text("Responding to @\(replying.label)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { self.replying = nil }
              }
            }
            HStack {
              TextField("Comment", text: $bodyText, axis: .vertical).lineLimit(1...5).focused(
                $focus
              ).padding(12).background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 22))
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
                  .white.opacity(0.15), in: Circle())
              }
              .disabled(bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
              .accessibilityLabel("Send comment")
            }
          }.padding(16).background(.black)
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
    loading = link == nil
    error = nil
    do {
      let result: SavedLink? = try await app.api?.request("/links/\(linkID)")
      try Task.checkCancellation()
      link = result
      if let result { author = try await app.api?.request("/profiles/\(result.ownerId)") }
      try await loadComments()
    } catch is CancellationError { return } catch {
      link = nil
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
  guard let date = formatter.date(from: value) else { return "" }
  let relative = RelativeDateTimeFormatter()
  relative.unitsStyle = .abbreviated
  return relative.localizedString(for: date, relativeTo: Date())
}
