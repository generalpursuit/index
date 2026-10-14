import IndexCore
import IndexFeatures
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct MessagesView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.screenVisible) private var visible
  @Environment(\.scenePhase) private var scenePhase
  @Environment(AccountStore.self) private var store
  private var model: ConversationListModel { store.inbox(query) }
  @State private var query = ""
  private var conversations: [Conversation] { !model.hasLoaded && error == nil ? (0..<5).map(ContentPlaceholder.conversation) : model.conversations }
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
        RequestError(error: error, retry: { await load() })
        Group {
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
        }.calmPlaceholder(active: !model.hasLoaded && error == nil)
        if model.hasLoaded && conversations.isEmpty && !loading && error == nil {
          Text("Good finds start conversations.").foregroundStyle(IndexPalette.subtleForeground).padding(.vertical, 30)
        }
        LoadMore(hasMore: cursor != nil) { await load(more: true) }
      }
    }.indexPage().refreshable { await load(force: true) }
      .onChange(of: visible, initial: true) { _, visible in store.inboxQuery = visible ? query : nil }
      .onDisappear { if store.inboxQuery == query { store.inboxQuery = nil } }
      .task(id: "\(query)-\(scenePhase)-\(visible)") {
        if visible { store.inboxQuery = query }
        guard visible, scenePhase == .active else { return }
        if !query.isEmpty { do { try await Task.sleep(for: .milliseconds(200)) } catch { return } }
        await load()
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
  private func load(more: Bool = false, force: Bool = false) async {
    guard let api = app.api else { return }
    do {
      try await store.refreshInbox(query, more: more, force: force)
    }
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
  @Environment(\.screenVisible) private var visible
  @Environment(AccountStore.self) private var store
  private var model: RecipientModel { store.recipients(query) }
  private var people: [Person] { !model.hasLoaded && error == nil ? (0..<5).map(ContentPlaceholder.person) : model.people }
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
        RequestError(error: error, retry: { await load() })
        Group {
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
        }.calmPlaceholder(active: !model.hasLoaded && error == nil)
        if model.hasLoaded && people.isEmpty && !loading && error == nil {
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
  @Environment(\.screenVisible) private var visible
  @Environment(\.scenePhase) private var scenePhase
  @Environment(AccountStore.self) private var store
  private var model: ConversationModel { store.conversation(conversationID, opening: app.navigation.openingConversation) }
  private var conversation: Conversation? { model.conversation ?? (error == nil ? ContentPlaceholder.conversation() : nil) }
  private var messages: [Message] { !model.hasLoaded && model.messages.isEmpty && error == nil ? (0..<4).map(ContentPlaceholder.message) : model.messages }
  private var cursor: String? { model.cursor }
  private var error: String? { model.error }
  private var loading: Bool { model.loading }
  private var sending: Bool { app.drafts.isSending(conversationID) }
  @State private var nearBottom = true
  @State private var scrollAfterSend = false
  /// The replied message just shown from a quote.
  @State private var highlighted: String?
  @FocusState private var focused: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
          Group {
            ParticipantAvatars(people: conversation.participants.filter { $0.id != app.userID })
            VStack(alignment: .leading, spacing: 3) {
              Text(conversation.title(viewerId: app.userID)).font(IndexFont.sans(16, weight: .medium)).lineLimit(2)
              Menu("Participants") {
                ForEach(conversation.participants.filter { $0.id != app.userID }) { person in
                  Button(person.name) { app.openProfile(person) }
                }
              }.font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
            }
          }.calmPlaceholder(active: model.conversation == nil && error == nil)
          Spacer()
        }.padding(.vertical, 8).padding(.bottom, 20)
      } else {
        HStack { BackButton(); Spacer() }.padding(.bottom, 20)
      }
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(spacing: 0) {
            RequestError(error: error, retry: { await refresh() })
            LoadMore(hasMore: cursor != nil) { try await more() }
            if let conversation {
              let loaded = Set(messages.map(\.id))
              ForEach(MessageTimeline.rows(messages.reversed())) { row in
                let original = row.message.replyTo?.id
                MessageRow(
                  row: row, conversation: conversation, read: row.message.id == readMessageID,
                  highlighted: row.message.id == highlighted, canReply: canReply, reply: { reply(to: row.message) },
                  showOriginal: original.flatMap { id in loaded.contains(id) ? { showOriginal(id, proxy: proxy) } : nil }
                ).id(row.id)
                if let status = model.sendStates[row.message.clientId] {
                  Text(status).font(IndexFont.sans(11)).foregroundStyle(IndexPalette.subtleForeground)
                    .frame(maxWidth: .infinity, alignment: .trailing).padding(.bottom, 6)
                }
              }
            }
            Color.clear.frame(height: 1).id("bottom").onAppear { nearBottom = true }.onDisappear {
              nearBottom = false
            }
          }.calmPlaceholder(active: !model.hasLoaded && model.messages.isEmpty && error == nil).padding(.bottom, 20)
        }.defaultScrollAnchor(.bottom)
          .onChange(of: messages.first?.clientId) { _, _ in
            if nearBottom || scrollAfterSend {
              proxy.scrollTo("bottom", anchor: .bottom)
              scrollAfterSend = false
            }
          }
          .scrollDismissesKeyboard(.interactively)
      }
    }.indexPage()
      .safeAreaInset(edge: .bottom) { if model.conversation != nil { composer } }
      .onAppear { store.openConversationID = conversationID }
      .onDisappear { if store.openConversationID == conversationID { store.openConversationID = nil } }
      .task(id: scenePhase) {
        guard visible, scenePhase == .active else { return }
        await refresh()
        focused = draft.attachment != nil
      }
      .task(id: highlighted) {
        guard highlighted != nil else { return }
        do { try await Task.sleep(for: .seconds(1.6)) } catch { return }
        highlighted = nil
      }
  }
  /// One rounded field: what the message answers and carries, then its text and send button.
  private var composer: some View {
    VStack(alignment: .leading, spacing: 8) {
      if draft.pending != nil && !sending {
        Text("Send not confirmed. Retry to check or complete this same message.").font(IndexFont.sans(12))
          .foregroundStyle(IndexPalette.subtleForeground)
      }
      VStack(alignment: .leading, spacing: 6) {
        if let original = draft.replyTo, let conversation {
          ComposerChip(
            symbol: "arrowshape.turn.up.left",
            title: conversation.replyLabel(viewerId: app.userID, from: app.userID, to: original.senderId),
            detail: original.preview, removal: "Cancel reply"
          ) { app.drafts.reply(to: nil, in: conversationID) }.disabled(draft.pending != nil)
        }
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
  /// Like the text, the replied message cannot change while a send is pending.
  private var canReply: Bool { conversation?.canSend == true && draft.pending == nil }
  private func reply(to message: Message) {
    app.drafts.reply(to: message, in: conversationID)
    focused = true
  }
  private func showOriginal(_ id: String, proxy: ScrollViewProxy) {
    let rowID = messages.first(where: { $0.id == id })?.clientId ?? id
    withAnimation(reduceMotion ? nil : .smooth) { proxy.scrollTo(rowID, anchor: .center) }
    highlighted = id
  }
  private func send() async throws {
    scrollAfterSend = draft.pending == nil
    try await store.send(in: conversationID)
    focused = true
  }
  private func refresh() async {
    let opening = app.navigation.openingConversation
    app.navigation.openingConversation = nil
    do { try await store.refreshConversation(conversationID, opening: opening) }
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
/// A long press offers Reply and Copy; swiping it right replies.
struct MessageRow: View {
  let row: MessageTimelineRow
  let conversation: Conversation
  /// Whether "Read" shows under this message.
  let read: Bool
  let highlighted: Bool
  let canReply: Bool
  let reply: () -> Void
  /// Shows the replied message; nil while it is not loaded.
  let showOriginal: (() -> Void)?
  @Environment(AppModel.self) private var app
  @Environment(\.screenVisible) private var visible
  private var message: Message { row.message }
  private var own: Bool { message.senderId == app.userID }
  // In 1:1 chats the header already names and pictures the other person.
  private var named: Bool { conversation.participants.count > 2 && !own }
  private var sender: Person? { conversation.participants.first { $0.id == message.senderId } }
  private var quoteLabel: String? {
    message.replyTo.map { conversation.replyLabel(viewerId: app.userID, from: message.senderId, to: $0.senderId) }
  }
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
        MessageContent(message: message, own: own, tail: row.endsRun, highlighted: highlighted) {
          if let original = message.replyTo, let quoteLabel {
            ReplyQuote(label: quoteLabel, excerpt: original.preview, own: own, show: showOriginal)
          }
        }
        #if os(iOS)
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 18))
        #endif
        .contextMenu {
          Button("Reply", systemImage: "arrowshape.turn.up.left", action: reply).disabled(!canReply)
          if !message.body.isEmpty {
            Button("Copy", systemImage: "doc.on.doc") { copy(message.body) }
          }
        }
        .modifier(SwipeToReply(enabled: canReply, reply: reply))
      }
      .padding(own ? .leading : .trailing, 42)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(spokenSummary)
      .accessibilityActions {
        if canReply { Button("Reply", action: reply) }
        if !message.body.isEmpty { Button("Copy") { copy(message.body) } }
        if let showOriginal { Button("Show replied message", action: showOriginal) }
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
  /// Sender, quote, text, post and time, read as one message.
  private var spokenSummary: String {
    var parts = [own ? "You" : sender?.name ?? "Former participant"]
    if let original = message.replyTo, let quoteLabel { parts.append(quoteLabel + ": " + original.preview) }
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
  private func copy(_ text: String) {
    #if os(iOS)
    UIPasteboard.general.string = text
    #else
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    #endif
  }
}
/// The replied message above a reply. It leads back to the original when that is loaded.
private struct ReplyQuote: View {
  let label: String
  let excerpt: String
  let own: Bool
  let show: (() -> Void)?
  var body: some View {
    if let show {
      Button(action: show) { content }.buttonStyle(.plain)
    } else {
      content
    }
  }
  private var content: some View {
    VStack(alignment: own ? .trailing : .leading, spacing: 2) {
      Text(label).font(IndexFont.sans(11.5, relativeTo: .caption)).foregroundStyle(IndexPalette.subtleForeground)
        .padding(.horizontal, 4)
      Text(excerpt).font(IndexFont.sans(13)).foregroundStyle(IndexPalette.mutedForeground).lineLimit(2)
        .multilineTextAlignment(.leading).padding(.horizontal, 11).padding(.vertical, 5)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(IndexPalette.border))
    }.padding(.bottom, 2)
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
/// A message's quote, text bubble and shared post. Only the last bubble of a run has a tail,
/// and only when no card follows it: a card is its own surface.
struct MessageContent<Quote: View>: View {
  let message: Message
  let own: Bool
  let tail: Bool
  let highlighted: Bool
  @ViewBuilder let quote: () -> Quote
  private var card: Bool { message.attachment != nil || message.restrictedAuthor != nil || message.hasAttachment }
  var body: some View {
    VStack(alignment: own ? .trailing : .leading, spacing: 2) {
      quote()
      if !message.body.isEmpty {
        Text(message.body).font(IndexFont.sans(15)).padding(.horizontal, 13).padding(.vertical, 8)
          .foregroundStyle(own ? IndexPalette.primaryForeground : IndexPalette.foreground)
          .background(own ? IndexPalette.primary : IndexPalette.muted, in: bubble)
          .overlay(bubble.stroke(IndexPalette.ring, lineWidth: 2).opacity(highlighted ? 1 : 0))
      }
      SharedPostCard(message: message, highlighted: highlighted)
    }.animation(.easeOut(duration: 0.2), value: highlighted)
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
  var highlighted = false
  @Environment(AppModel.self) private var app
  @Environment(\.screenVisible) private var visible
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
    .overlay(
      RoundedRectangle(cornerRadius: 16)
        .stroke(highlighted ? IndexPalette.ring : IndexPalette.border, lineWidth: highlighted ? 2 : 1))
    .contentShape(RoundedRectangle(cornerRadius: 16))
  }
}
/// Swiping a message right replies to it, as in Messages: the message follows the finger with
/// resistance, uncovers a reply icon and springs back on release. Reduced motion keeps the
/// message still and only reveals the icon. iOS 17 offers Reply from the message's menu only.
private struct SwipeToReply: ViewModifier {
  let enabled: Bool
  let reply: () -> Void
  /// How far the message must travel before letting go replies.
  private static let threshold: CGFloat = 56
  /// The message slows as it nears this distance, so it never leaves the finger far behind.
  private static let reach: CGFloat = 96
  @State private var offset: CGFloat = 0
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var armed: Bool { offset >= Self.threshold }
  func body(content: Content) -> some View {
    #if os(iOS)
    if #available(iOS 18.0, *) {
      content
        .offset(x: reduceMotion ? 0 : offset)
        .background(alignment: .leading) {
          Image(systemName: "arrowshape.turn.up.left.fill").font(.system(size: 12, weight: .semibold))
            .foregroundStyle(armed ? IndexPalette.foreground : IndexPalette.subtleForeground)
            .frame(width: 28, height: 28).background(IndexPalette.muted, in: Circle())
            .scaleEffect(armed ? 1.1 : 1).opacity(min(1, offset / Self.threshold))
            .animation(.easeOut(duration: 0.15), value: armed).accessibilityHidden(true)
        }
        .gesture(
          ReplySwipeGesture(enabled: enabled) { translation in
            offset = Self.reach * (1 - exp(-max(0, translation) / Self.reach))
          } ended: { completed in
            let replying = completed && armed
            withAnimation(reduceMotion ? nil : .spring(duration: 0.22)) { offset = 0 }
            if replying { reply() }
          }
        )
        .sensoryFeedback(.impact(weight: .light), trigger: armed) { _, armed in armed }
    } else {
      content
    }
    #else
    content
    #endif
  }
}
#if os(iOS)
/// A rightward pan that starts on a message. Enclosing pans, the thread's scroll and the system
/// back swipes, wait for it to fail; it fails as soon as a move is vertical or leftward or
/// starts at the left edge, so they keep working.
@available(iOS 18.0, *)
private struct ReplySwipeGesture: UIGestureRecognizerRepresentable {
  let enabled: Bool
  let changed: (CGFloat) -> Void
  let ended: (_ completed: Bool) -> Void
  func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }
  func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
    let pan = UIPanGestureRecognizer()
    pan.delegate = context.coordinator
    return pan
  }
  func updateUIGestureRecognizer(_ pan: UIPanGestureRecognizer, context: Context) { pan.isEnabled = enabled }
  func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
    switch pan.state {
    case .began, .changed: changed(pan.translation(in: pan.view?.window).x)
    case .ended: ended(true)
    default: ended(false)
    }
  }
  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    /// Touches starting this close to the left edge belong to the back swipe.
    private let backSwipeEdge: CGFloat = 28
    func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
      guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
      let window = pan.view?.window
      let move = pan.translation(in: window)
      // Vertical moves scroll and leftward ones are not replies.
      return move.x > abs(move.y) && pan.location(in: window).x - move.x >= backSwipeEdge
    }
    func gestureRecognizer(
      _ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer
    ) -> Bool { other is UIPanGestureRecognizer }
  }
}
#endif
