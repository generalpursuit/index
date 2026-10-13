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
  /// As in iMessage, a 1:1 receipt shows only while the viewer's message is the newest.
  private var readMessageID: String? {
    guard let conversation, conversation.participants.count <= 2, let newest = messages.first,
      newest.senderId == app.userID, newest.id == conversation.readReceiptMessageId
    else { return nil }
    return newest.id
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
          LazyVStack(spacing: 0) {
            LoadingError(error: error, loading: loading, retry: { await refresh() })
            LoadMore(hasMore: cursor != nil) { try await more() }
            ForEach(MessageTimeline.rows(messages.reversed())) { row in
              MessageRow(row: row, participants: conversation?.participants ?? [], read: row.id == readMessageID)
                .id(row.id)
            }
            Color.clear.frame(height: 1).id("bottom").onAppear { nearBottom = true }.onDisappear {
              nearBottom = false
            }
          }.padding(.bottom, 20)
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
  /// One rounded field: the attached post, then the text with its send button.
  private var composer: some View {
    VStack(alignment: .leading, spacing: 8) {
      if draft.pending != nil && !sending {
        Text("Send not confirmed. Retry to check or complete this same message.").font(IndexFont.sans(12))
          .foregroundStyle(IndexPalette.subtleForeground)
      }
      VStack(alignment: .leading, spacing: 6) {
        if let attachment = draft.attachment {
          ComposerChip(symbol: "link", title: attachment.title, detail: "· " + attachment.domain, removal: "Remove attachment") {
            do { try app.drafts.attach(nil, to: conversationID) } catch { app.handle(error) }
          }.disabled(draft.pending != nil)
        }
        HStack(alignment: .bottom, spacing: 6) {
          // A vertical field breaks the line on Return, as in Messages; only the button sends.
          TextField("Message", text: text, axis: .vertical).lineLimit(1...6).focused($focused)
            .font(IndexFont.sans(16)).padding(.leading, 10).padding(.vertical, 7)
            .disabled(draft.pending != nil)
          AsyncButton(action: send) {
            Image(systemName: draft.pending == nil ? "arrow.up" : "arrow.clockwise")
              .font(.system(size: 15, weight: .semibold)).frame(width: 34, height: 34)
              .background(IndexPalette.primary, in: Circle()).foregroundStyle(IndexPalette.primaryForeground)
              .opacity(canSend ? 1 : 0.4)
          }
          .disabled(!canSend)
          .accessibilityLabel(draft.pending == nil ? "Send message" : "Retry message")
        }
      }
      .padding(6)
      .background(IndexPalette.background, in: RoundedRectangle(cornerRadius: 22))
      .overlay(RoundedRectangle(cornerRadius: 22).stroke(focused ? IndexPalette.input : IndexPalette.border))
    }.padding(.horizontal, 20).padding(.vertical, 10).background(IndexPalette.background)
  }
  private var canSend: Bool { conversation?.canSend == true && !draft.isEmpty }
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
/// What the next message carries, shown inside the composer.
private struct ComposerChip: View {
  let symbol: String
  let title: String
  let detail: String
  let removal: String
  let remove: () -> Void
  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: symbol).font(.system(size: 13)).foregroundStyle(IndexPalette.subtleForeground)
        .accessibilityHidden(true)
      Text("\(Text(title).font(IndexFont.sans(13, weight: .medium))) \(Text(detail).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground))")
        .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
      Button(action: remove) {
        Image(systemName: "xmark").font(.system(size: 12, weight: .medium)).frame(width: 28, height: 28)
          .contentShape(Rectangle())
      }.buttonStyle(.plain).foregroundStyle(IndexPalette.subtleForeground).accessibilityLabel(removal)
    }
    .padding(.leading, 10).padding(2).frame(minHeight: 36)
    .background(IndexPalette.surface, in: RoundedRectangle(cornerRadius: 14))
  }
}
/// A message in its sender's run, as iMessage shows it: a stamp when it opens a section, and in
/// group chats the sender's name above an incoming run and their avatar beside its last bubble.
struct MessageRow: View {
  let row: MessageTimelineRow
  let participants: [Person]
  /// Whether "Read" shows under this message.
  let read: Bool
  @Environment(AppModel.self) private var app
  private var message: Message { row.message }
  private var own: Bool { message.senderId == app.userID }
  // In 1:1 chats the header already names and pictures the other person.
  private var named: Bool { participants.count > 2 && !own }
  private var sender: Person? { participants.first { $0.id == message.senderId } }
  var body: some View {
    VStack(alignment: own ? .trailing : .leading, spacing: 2) {
      if let stamp = row.stamp { MessageStampLabel(date: stamp) }
      if named && row.startsRun {
        Text(sender?.name ?? "Former participant").font(IndexFont.sans(11.5, relativeTo: .caption))
          .foregroundStyle(IndexPalette.subtleForeground).padding(.leading, 40).accessibilityHidden(true)
      }
      HStack(alignment: .bottom, spacing: 8) {
        if named {
          if row.endsRun, let sender {
            PersonAvatar(person: sender, size: 28)
          } else {
            Color.clear.frame(width: 28, height: 0)
          }
        }
        MessageContent(message: message, own: own, tail: row.endsRun)
      }
      .padding(own ? .leading : .trailing, 42)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(spokenSummary)
      .accessibilityActions {
        if let attachment = message.attachment {
          Button("Open post") { app.openLink(attachment) }
        } else if let author = message.restrictedAuthor {
          Button("View profile") { app.navigate(.profile(author.id)) }
        }
      }
      if read {
        Text("Read").font(IndexFont.sans(11, relativeTo: .caption)).foregroundStyle(IndexPalette.subtleForeground)
          .padding(.trailing, 4).accessibilityHidden(true)
      }
    }
    .frame(maxWidth: .infinity, alignment: own ? .trailing : .leading)
    .padding(.top, row.stamp != nil ? 0 : row.startsRun ? 12 : 2)
  }
  /// Sender, text, post and time, read as one message.
  private var spokenSummary: String {
    var parts = [own ? "You" : sender?.name ?? "Former participant"]
    if !message.body.isEmpty { parts.append(message.body) }
    if let attachment = message.attachment {
      parts.append("Shared post, \(attachment.title), \(attachment.domain)")
    } else if let author = message.restrictedAuthor {
      parts.append("Private post from @\(author.label)")
    } else if message.hasAttachment {
      parts.append("Post unavailable")
    }
    if let date = APITimestamp.date(message.createdAt) { parts.append(MessageTimeline.stamp(date).text) }
    if read { parts.append("Read") }
    return parts.joined(separator: ", ")
  }
}
/// A centred section stamp with its day emphasised, such as "**Today** 11:15".
struct MessageStampLabel: View {
  let date: Date
  var body: some View {
    let stamp = MessageTimeline.stamp(date)
    Text("\(Text(stamp.day).font(IndexFont.sans(11.5, weight: .semibold, relativeTo: .caption))) \(stamp.time)")
      .font(IndexFont.sans(11.5, relativeTo: .caption)).foregroundStyle(IndexPalette.subtleForeground)
      .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.top, 18).padding(.bottom, 10)
  }
}
/// A message's text bubble and shared post. Only the last bubble of a run has a tail, and only
/// when no card follows it: a card is its own surface.
struct MessageContent: View {
  let message: Message
  let own: Bool
  let tail: Bool
  private var card: Bool { message.attachment != nil || message.restrictedAuthor != nil || message.hasAttachment }
  var body: some View {
    VStack(alignment: own ? .trailing : .leading, spacing: 2) {
      if !message.body.isEmpty {
        Text(message.body).font(IndexFont.sans(15)).padding(.horizontal, 13).padding(.vertical, 8)
          .foregroundStyle(own ? IndexPalette.primaryForeground : IndexPalette.foreground)
          .background(own ? IndexPalette.primary : IndexPalette.muted, in: bubble)
      }
      SharedPostCard(message: message)
    }
  }
  private var bubble: UnevenRoundedRectangle {
    let tailed = tail && !card
    return UnevenRoundedRectangle(
      topLeadingRadius: 18, bottomLeadingRadius: tailed && !own ? 5 : 18,
      bottomTrailingRadius: tailed && own ? 5 : 18, topTrailingRadius: 18)
  }
}
/// A post shared in a message. It never takes a bubble's colours, so it reads in either
/// appearance and beside either sender's bubbles.
struct SharedPostCard: View {
  let message: Message
  @Environment(AppModel.self) private var app
  var body: some View {
    if let attachment = message.attachment {
      Button { app.openLink(attachment) } label: {
        card(symbol: "link") {
          Text(attachment.title).font(IndexFont.sans(14, weight: .medium))
          Text(attachment.domain).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
        }
      }.buttonStyle(.plain)
    } else if let author = message.restrictedAuthor {
      Button { app.navigate(.profile(author.id)) } label: {
        card(symbol: "lock") {
          Text("Private post from @\(author.label)").font(IndexFont.sans(14, weight: .medium))
          Text("Only approved followers can view this post.").font(IndexFont.sans(12))
            .foregroundStyle(IndexPalette.subtleForeground)
          Text("View profile").font(IndexFont.sans(12)).underline().padding(.top, 4)
        }
      }.buttonStyle(.plain)
    } else if message.hasAttachment {
      card(symbol: "lock") {
        Text("Post unavailable").font(IndexFont.sans(14)).foregroundStyle(IndexPalette.subtleForeground)
      }
    }
  }
  private func card(symbol: String, @ViewBuilder content: () -> some View) -> some View {
    HStack(spacing: 12) {
      Image(systemName: symbol).font(.system(size: 14)).foregroundStyle(IndexPalette.subtleForeground)
      VStack(alignment: .leading, spacing: 2) { content() }.frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 14).padding(.vertical, 10).frame(maxWidth: 280)
    .foregroundStyle(IndexPalette.foreground)
    .background(IndexPalette.surface, in: RoundedRectangle(cornerRadius: 16))
    .overlay(RoundedRectangle(cornerRadius: 16).stroke(IndexPalette.border))
    .contentShape(RoundedRectangle(cornerRadius: 16))
  }
}
