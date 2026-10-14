import IndexCore
import IndexFeatures
import SwiftUI

/// Edits a saved link laid out like the post itself, and deletes it. Links are added from the
/// week's field, so this is the only form for a link.
struct EditLinkView: View {
  let link: SavedLink
  init(link: SavedLink) {
    self.link = link
    _url = State(initialValue: link.url)
    _title = State(initialValue: link.title)
    _note = State(initialValue: link.description ?? "")
    _groupID = State(initialValue: link.groupId ?? "")
    _initialized = State(initialValue: true)
  }
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
    try await app.store?.editLink(link, body: body)
    dismiss()
  }
  private func delete() async {
    do {
      try await app.store?.deleteLink(link)
      app.navigation.sheet = nil
      // The link's own page has nothing left to show.
      if app.navigation.path.last == .link(link.id) { app.navigation.path.removeLast() }
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
  @Environment(AccountStore.self) private var store
  private var model: LinkModel { store.link(linkID, opening: app.navigation.openingLink?.id == linkID ? app.navigation.openingLink : nil) }
  private var link: SavedLink? { model.link ?? (error == nil && !model.deleted ? ContentPlaceholder.link() : nil) }
  private var author: Profile? { model.author }
  private var group: LinkGroup? { model.group }
  private var comments: [Comment] { model.comments }
  private var cursor: String? { model.cursor }
  private var error: String? { model.error }
  @State private var bodyText = ""
  @State private var replying: Person?
  @State private var deleting: Comment?
  @FocusState private var focus: Bool
  @Environment(\.indexSheet) private var isSheet
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        RequestError(error: error, retry: { await load() })
        if let link {
          HStack(spacing: 8) {
            if !isSheet { Color.clear.frame(width: 44, height: 44) }
            LinkLabel(link: link, group: group)
            Spacer(minLength: 0)
            if isSheet { Color.clear.frame(width: 44, height: 44) }
          }
          VStack(alignment: .leading, spacing: 12) {
            Text(link.title).font(IndexFont.serif(32)).tracking(-0.48).textSelection(.enabled)
              .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
              if let author {
                Button { app.openProfile(author.person) } label: {
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
                  app.openProfile(person)
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
    }.calmPlaceholder(active: model.link == nil && !model.deleted && error == nil).indexPage()
      .overlay(alignment: .topTrailing) { if isSheet { SheetCloseButton().padding(20) } }
      .overlay(alignment: .topLeading) { if !isSheet { BackButton().padding(20) } }
      .safeAreaInset(edge: .bottom) {
        if model.link != nil {
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
                guard let api = app.api, let profile = app.profile else { return }
                let originalText = bodyText
                bodyText = ""
                replying = nil
                do { try await model.addComment(id: linkID, body: text, author: profile.person, api: api) }
                catch { bodyText = originalText; throw error }
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
              guard let api = app.api else { return }
              try await model.deleteComment(comment, api: api)
              deleting = nil
            } catch { app.handle(error) }
          }
        }
      }
      .task(id: linkID) { await load() }
  }
  private func load() async {
    guard let api = app.api else { return }
    do {
      try await store.show("link:" + linkID, path: "/links/\(linkID)", force: error != nil) { try await model.load(id: linkID, api: api) }
    } catch { app.handleSessionError(error) }
  }
  private func loadComments(more: Bool = false) async throws {
    guard let api = app.api else { return }
    try await model.loadComments(id: linkID, api: api, more: more)
  }
}
func relativeTime(_ value: String) -> String {
  guard let date = APITimestamp.date(value) else { return "" }
  let minutes = max(0, Int(Date().timeIntervalSince(date) / 60))
  return minutes < 1 ? "Now" : minutes < 60 ? "\(minutes)m" : minutes < 1440 ? "\(minutes / 60)h" : "\(minutes / 1440)d"
}
