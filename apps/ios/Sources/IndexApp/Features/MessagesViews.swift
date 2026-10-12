import IndexCore
import IndexFeatures
import SwiftUI

struct MessagesView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @State private var model = ConversationListModel()
  @State private var query = ""
  private var conversations: [Conversation] { model.conversations }
  private var cursor: String? { model.cursor }
  private var error: String? { model.error }
  private var loading: Bool { model.loading }
  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        HStack {
          PageHeading(title: "Messages")
          Button {
            app.present(.recipients(nil))
          } label: {
            Image(systemName: "square.and.pencil").font(.title2).frame(width: 44, height: 44)
          }.accessibilityLabel("New message")
        }
        SearchField(placeholder: "Search conversations", text: $query).padding(.top, 26).padding(.bottom, 20)
        LoadingError(error: error, loading: loading, retry: { await load() })
        ForEach(conversations) { conversation in
          Button {
            app.navigation.openingConversation = conversation
            app.navigate(.conversation(conversation.id))
          } label: {
            HStack(spacing: 16) {
              ParticipantAvatars(people: conversation.participants.filter { $0.id != app.userID })
              VStack(alignment: .leading, spacing: 1) {
                Text(conversation.title(viewerId: app.userID)).font(IndexFont.sans(14)).bold().lineLimit(
                  1)
                Text(preview(conversation)).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground).lineLimit(1)
              }
              Spacer(minLength: 0)
              if conversation.unreadCount > 0 { Circle().frame(width: 7, height: 7) }
              Text(relativeTime(conversation.updatedAt)).font(IndexFont.sans(11)).foregroundStyle(IndexPalette.subtleForeground)
            }.padding(.vertical, 18).contentShape(Rectangle())
          }.buttonStyle(.plain)
        }
        if conversations.isEmpty && !loading && error == nil {
          Text("Good finds start conversations.").foregroundStyle(IndexPalette.subtleForeground).padding(.vertical, 30)
        }
        LoadMore(hasMore: cursor != nil) { await load(more: true) }
      }
    }.indexPage().refreshable { await load() }
      .task(id: "\(query)-\(scenePhase)") {
        guard scenePhase == .active else { return }
        if !query.isEmpty { do { try await Task.sleep(for: .milliseconds(200)) } catch { return } }
        await load()
        while !Task.isCancelled {
          do { try await Task.sleep(for: .seconds(10)) } catch { return }
          await load()
        }
      }
  }
  private func preview(_ conversation: Conversation) -> String {
    let draft = app.drafts.draft(for: conversation.id)
    if !draft.body.isEmpty || draft.attachment != nil {
      return "Draft: " + (draft.body.isEmpty ? "Link" : draft.body)
    }
    guard let message = conversation.lastMessage else { return "Start a conversation" }
    let text =
      !message.body.isEmpty
      ? message.body
      : message.attachment?.title
        ?? (message.restrictedAuthor != nil
          ? "Private post" : message.hasAttachment ? "Post unavailable" : "Message")
    return (message.senderId == app.userID ? "You: " : "") + text
  }
  private func load(more: Bool = false) async {
    guard let api = app.api else { return }
    do { try await model.load(api: api, query: query, more: more) }
    catch { app.handleSessionError(error) }
  }
}
struct ParticipantAvatars: View {
  let people: [Person]
  var body: some View {
    if people.count == 1, let person = people.first {
      PersonAvatar(person: person, size: 36)
    } else {
      ZStack {
        ForEach(Array(people.prefix(3).enumerated()), id: \.element.id) { index, person in
          PersonAvatar(person: person, size: 29).overlay(Circle().stroke(IndexPalette.background, lineWidth: 2))
            .offset(x: CGFloat(index % 2) * 15 - 7, y: CGFloat(index) * 9 - 9)
        }
      }.frame(width: 46, height: 46)
    }
  }
}
struct RecipientView: View {
  let attachment: SavedLink?
  @Environment(AppModel.self) private var app
  @State private var model = RecipientModel()
  private var people: [Person] { model.people }
  @State private var selected: [Person] = []
  private var after: String? { model.after }
  @State private var query = ""
  private var error: String? { model.error }
  private var loading: Bool { model.loading }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        PageHeading(title: attachment == nil ? "New message" : "Send link")
        if !selected.isEmpty {
          ScrollView(.horizontal) {
            HStack {
              ForEach(selected) { person in
                Button {
                  selected.removeAll { $0.id == person.id }
                } label: {
                  Label(person.label, systemImage: "xmark")
                }.buttonStyle(PillStyle())
              }
            }
          }
        }
        SearchField(placeholder: "Search people you follow", text: $query)
        LoadingError(error: error, loading: loading, retry: { await load() })
        ForEach(people) { person in
          Button {
            if selected.contains(where: { $0.id == person.id }) {
              selected.removeAll { $0.id == person.id }
            } else if selected.count < 19 {
              selected.append(person)
            }
          } label: {
            HStack {
              PersonRow(person: person)
              Image(
                systemName: selected.contains(where: { $0.id == person.id })
                  ? "checkmark.circle.fill" : "circle"
              ).font(.title3)
            }
          }.buttonStyle(.plain)
        }
        if people.isEmpty && !loading && error == nil {
          Text("Follow someone to start a conversation.").foregroundStyle(IndexPalette.subtleForeground).padding()
        }
        LoadMore(hasMore: after != nil) { await load(more: true) }
      }
    }.indexPage()
      .safeAreaInset(edge: .bottom) {
        AsyncButton {
          guard let api = app.api else { return }
          let generation = app.session.generation
          let conversation = try await model.create(api: api, recipients: selected)
          try Task.checkCancellation()
          guard generation == app.session.generation else { return }
          if let attachment { try app.drafts.attach(attachment, to: conversation.id) }
          if app.navigation.sheet == nil && !app.navigation.path.isEmpty { app.navigation.path.removeLast() }
          app.navigation.openingConversation = conversation
          app.navigate(.conversation(conversation.id))
        } label: {
          Text("Continue\(selected.isEmpty ? "" : " · \(selected.count)")").frame(
            maxWidth: .infinity)
        }.buttonStyle(PillStyle(selected: true)).disabled(selected.isEmpty).padding(20).background(
          IndexPalette.background)
      }
      .task(id: query) {
        do {
          try await Task.sleep(for: .milliseconds(200))
          await load()
        } catch {}
      }
  }
  private func load(more: Bool = false) async {
    guard let api = app.api else { return }
    do { try await model.load(api: api, account: app.userID, query: query, more: more) }
    catch { app.handleSessionError(error) }
  }
}

struct ConversationView: View {
  let conversationID: String
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @State private var model = ConversationModel()
  private var conversation: Conversation? { model.conversation }
  private var messages: [Message] { model.messages }
  private var cursor: String? { model.cursor }
  private var error: String? { model.error }
  private var loading: Bool { model.loading }
  private var sending: Bool { app.drafts.isSending(conversationID) }
  @State private var nearBottom = true
  @State private var scrollAfterSend = false
  @FocusState private var focused: Bool
  private var draft: MessageDraft { app.drafts.draft(for: conversationID) }
  private var text: Binding<String> {
    Binding(get: { draft.body }, set: { app.drafts.edit($0, in: conversationID) })
  }
  var body: some View {
    VStack(spacing: 0) {
      if let conversation {
        HStack(spacing: 12) {
          BackButton()
          ParticipantAvatars(people: conversation.participants.filter { $0.id != app.userID })
          VStack(alignment: .leading, spacing: 3) {
            Text(conversation.title(viewerId: app.userID)).font(IndexFont.sans(16, weight: .medium)).lineLimit(2)
            Menu("Participants") {
              ForEach(conversation.participants.filter { $0.id != app.userID }) { person in
                Button(person.name) { app.navigate(.profile(person.id)) }
              }
            }.font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
          }
          Spacer()
        }.padding(.vertical, 8).padding(.bottom, 20)
      } else {
        HStack { BackButton(); Spacer() }.padding(.bottom, 20)
      }
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(spacing: 18) {
            LoadingError(error: error, loading: loading, retry: { await refresh() })
            LoadMore(hasMore: cursor != nil) { try await more() }
            ForEach(messages.reversed()) { message in
              MessageBubble(message: message, participants: conversation?.participants ?? [])
                .id(message.id)
            }
            Color.clear.frame(height: 1).id("bottom").onAppear { nearBottom = true }.onDisappear {
              nearBottom = false
            }
          }.padding(.vertical, 20)
        }.defaultScrollAnchor(.bottom)
          .onChange(of: messages.first?.id) { _, _ in
            if nearBottom || scrollAfterSend {
              proxy.scrollTo("bottom", anchor: .bottom)
              scrollAfterSend = false
            }
          }
          .scrollDismissesKeyboard(.interactively)
      }
    }.indexPage()
      .safeAreaInset(edge: .bottom) { if conversation != nil { composer } }
      .task(id: scenePhase) {
        guard scenePhase == .active else { return }
        await refresh()
        focused = draft.attachment != nil
        while !Task.isCancelled {
          do { try await Task.sleep(for: .seconds(5)) } catch { return }
          await refresh()
        }
      }
  }
  private var composer: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let attachment = draft.attachment {
        HStack {
          Image(systemName: attachment.category.symbol)
          VStack(alignment: .leading, spacing: 4) {
            Text(attachment.title).font(IndexFont.sans(14)).lineLimit(1)
            Text(attachment.domain).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
          }
          Spacer()
          if draft.pending == nil {
            Button {
              do { try app.drafts.attach(nil, to: conversationID) } catch { app.handle(error) }
            } label: {
              Image(systemName: "xmark").frame(width: 32, height: 32)
            }.accessibilityLabel("Remove attachment")
          }
        }.padding(14).background(IndexPalette.surface, in: RoundedRectangle(cornerRadius: 14))
      }
      if draft.pending != nil && !sending {
        Text("Send not confirmed. Retry to check or complete this same message.").font(IndexFont.sans(12))
          .foregroundStyle(IndexPalette.subtleForeground)
      }
      HStack {
        TextField("Message", text: text, axis: .vertical).lineLimit(1...5).focused($focused)
          .font(IndexFont.sans(16)).padding(.horizontal, 14).padding(.vertical, 10)
          .overlay(Capsule().stroke(IndexPalette.border, lineWidth: 1))
          .disabled(draft.pending != nil)
        AsyncButton(action: send) {
          Image(systemName: draft.pending == nil ? "arrow.up" : "arrow.clockwise").frame(
            width: 42, height: 42
          ).background(IndexPalette.primary, in: Circle()).foregroundStyle(IndexPalette.primaryForeground)
        }
        .disabled(
          conversation?.canSend != true
            || (draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              && draft.attachment == nil)
        )
        .accessibilityLabel(draft.pending == nil ? "Send message" : "Retry message")
      }
    }.padding(.horizontal, 20).padding(.vertical, 12).background(IndexPalette.background)
  }
  private func send() async throws {
    guard let api = app.api else { return }
    try await app.drafts.send(in: conversationID, api: api)
    scrollAfterSend = true
    focused = true
    await refresh()
  }
  private func refresh() async {
    guard let api = app.api else { return }
    let opening = app.navigation.openingConversation
    app.navigation.openingConversation = nil
    do { try await model.load(api: api, id: conversationID, opening: opening) }
    catch { app.handleSessionError(error) }
  }
  private func more() async throws {
    guard let api = app.api else { return }
    try await model.load(api: api, id: conversationID, more: true)
  }
}
struct MessageBubble: View {
  let message: Message
  let participants: [Person]
  @Environment(AppModel.self) private var app
  var own: Bool { message.senderId == app.userID }
  var body: some View {
    HStack {
      if own { Spacer(minLength: 42) }
      VStack(alignment: own ? .trailing : .leading, spacing: 6) {
        if !own && participants.count > 2 {
          Text(participants.first(where: { $0.id == message.senderId })?.name ?? "Former participant")
            .font(IndexFont.sans(10)).foregroundStyle(IndexPalette.subtleForeground)
        }
        VStack(alignment: .leading, spacing: 0) {
          attachment
          if !message.body.isEmpty {
            Text(message.body).font(IndexFont.sans(13)).textSelection(.enabled)
              .padding(.horizontal, 14).padding(.vertical, 11)
          }
        }.background(own ? IndexPalette.primary : IndexPalette.muted)
          .foregroundStyle(own ? IndexPalette.primaryForeground : IndexPalette.foreground)
          .clipShape(UnevenRoundedRectangle(topLeadingRadius: 19, bottomLeadingRadius: own ? 19 : 5,
            bottomTrailingRadius: own ? 5 : 19, topTrailingRadius: 19))
        Text(relativeTime(message.createdAt)).font(IndexFont.sans(10))
          .foregroundStyle(IndexPalette.subtleForeground).padding(.horizontal, 4)
      }.frame(maxWidth: 420, alignment: own ? .trailing : .leading)
      if !own { Spacer(minLength: 42) }
    }
  }
  @ViewBuilder private var attachment: some View {
    if let attachment = message.attachment {
      Button { app.openLink(attachment) } label: {
        HStack(spacing: 12) {
          Image(systemName: "link").font(.system(size: 20))
          VStack(alignment: .leading, spacing: 4) {
            Text(attachment.title).font(IndexFont.sans(13, weight: .medium))
            Text(attachment.domain).font(IndexFont.sans(11)).foregroundStyle(IndexPalette.subtleForeground)
          }.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.horizontal, 16).padding(.vertical, 18)
          .background(IndexPalette.surface).foregroundStyle(IndexPalette.foreground)
      }.buttonStyle(.plain)
    } else if let author = message.restrictedAuthor {
      Button { app.navigate(.profile(author.id)) } label: {
        VStack(alignment: .leading, spacing: 6) {
          Label("Private post from @\(author.label)", systemImage: "lock").font(IndexFont.sans(13, weight: .medium))
          Text("Only approved followers can view this post.").font(IndexFont.sans(11))
          Text("View profile").font(IndexFont.sans(12)).underline()
        }.padding(16).background(IndexPalette.surface).foregroundStyle(IndexPalette.foreground)
      }.buttonStyle(.plain)
    } else if message.hasAttachment {
      Label("Post unavailable", systemImage: "lock").font(IndexFont.sans(13))
        .padding(16).background(IndexPalette.surface).foregroundStyle(IndexPalette.foreground)
    }
  }
}
