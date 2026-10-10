import IndexCore
import SwiftUI

struct MessagesView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @State private var conversations: [Conversation] = []
  @State private var cursor: String?
  @State private var query = ""
  @State private var error: String?
  @State private var loading = false
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
            app.openingConversation = conversation
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
    if let draft = app.drafts[conversation.id], !draft.body.isEmpty || draft.attachment != nil {
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
    loading = conversations.isEmpty
    error = nil
    var params = ["limit": "30"]
    if !query.isEmpty { params["query"] = query }
    if more { params["cursor"] = cursor }
    if !more, conversations.isEmpty,
      let cached: Page<Conversation> = await app.api?.cached("/conversations", query: params)
    {
      conversations = cached.items
      cursor = cached.nextCursor
      loading = false
    }
    do {
      if let page: Page<Conversation> = try await app.api?.request("/conversations", query: params)
      {
        conversations = more ? conversations + page.items : page.items
        cursor = page.nextCursor
      }
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
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
  @State private var people: [Person] = []
  @State private var selected: [Person] = []
  @State private var after: String?
  @State private var query = ""
  @State private var error: String?
  @State private var loading = false
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
          guard
            let conversation: Conversation = try await app.api?.request(
              "/conversations", method: "POST", body: ["recipientIds": .strings(selected.map(\.id))]
            )
          else { return }
          if let attachment {
            var draft = app.drafts[conversation.id] ?? MessageDraft()
            guard draft.attemptedBody == nil else {
              app.error =
                "Retry the pending message in this conversation before attaching another link."
              return
            }
            draft.attachment = attachment
            app.drafts[conversation.id] = draft
          }
          if app.sheet == nil && !app.path.isEmpty { app.path.removeLast() }
          app.openingConversation = conversation
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
    loading = true
    error = nil
    var params = ["limit": "30"]
    if !query.isEmpty { params["query"] = query }
    if more { params["after"] = after }
    do {
      if let page: PeoplePage = try await app.api?.request(
        "/profiles/\(app.userID)/following", query: params)
      {
        people = more ? people + page.items : page.items
        after = page.nextAfter
      }
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
  }
}

struct ConversationView: View {
  let conversationID: String
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @State private var conversation: Conversation?
  @State private var messages: [Message] = []
  @State private var cursor: String?
  @State private var pageCount = 1
  @State private var error: String?
  @State private var loading = true
  @State private var sending = false
  @State private var nearBottom = true
  @State private var scrollAfterSend = false
  @FocusState private var focused: Bool
  private var draft: MessageDraft { app.drafts[conversationID] ?? MessageDraft() }
  private var text: Binding<String> {
    Binding(
      get: { app.drafts[conversationID]?.body ?? "" },
      set: { value in
        var draft = app.drafts[conversationID] ?? MessageDraft()
        draft.body = value
        app.drafts[conversationID] = draft
      })
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
      .safeAreaInset(edge: .bottom) { composer }
      .task(id: scenePhase) {
        guard scenePhase == .active else { return }
        if app.drafts[conversationID] == nil { app.drafts[conversationID] = MessageDraft() }
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
          if draft.attemptedBody == nil {
            Button {
              app.drafts[conversationID]?.attachment = nil
            } label: {
              Image(systemName: "xmark").frame(width: 32, height: 32)
            }.accessibilityLabel("Remove attachment")
          }
        }.padding(14).background(IndexPalette.surface, in: RoundedRectangle(cornerRadius: 14))
      }
      if draft.attemptedBody != nil && !sending {
        Text("Send not confirmed. Retry to check or complete this same message.").font(IndexFont.sans(12))
          .foregroundStyle(IndexPalette.subtleForeground)
      }
      HStack {
        TextField("Message", text: text, axis: .vertical).lineLimit(1...5).focused($focused)
          .font(IndexFont.sans(16)).padding(.horizontal, 14).padding(.vertical, 10)
          .overlay(Capsule().stroke(IndexPalette.border, lineWidth: 1))
          .disabled(draft.attemptedBody != nil)
        AsyncButton(action: send) {
          Image(systemName: draft.attemptedBody == nil ? "arrow.up" : "arrow.clockwise").frame(
            width: 42, height: 42
          ).background(IndexPalette.primary, in: Circle()).foregroundStyle(IndexPalette.primaryForeground)
        }
        .disabled(
          conversation?.canSend != true
            || (draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              && draft.attachment == nil)
        )
        .accessibilityLabel(draft.attemptedBody == nil ? "Send message" : "Retry message")
      }
    }.padding(.horizontal, 20).padding(.vertical, 12).background(IndexPalette.background)
  }
  private func send() async throws {
    var value = draft
    if value.attemptedBody == nil {
      value.attemptedBody = value.body.trimmingCharacters(in: .whitespacesAndNewlines)
      value.attemptedLinkID = value.attachment?.id
    }
    app.drafts[conversationID] = value
    sending = true
    defer { sending = false }
    var body: [String: JSONValue] = [
      "clientId": .string(value.clientID), "body": .string(value.attemptedBody ?? ""),
    ]
    if let id = value.attemptedLinkID { body["linkId"] = .string(id) }
    do {
      let _: Message? = try await app.api?.request(
        "/conversations/\(conversationID)/messages", method: "POST", body: body)
      app.drafts[conversationID] = MessageDraft()
      scrollAfterSend = true
      focused = true
      await refresh()
    } catch {
      // Definite validation failures were not sent, so the draft can be corrected.
      if case APIError.server(let status, _) = error, (400..<500).contains(status) {
        value.attemptedBody = nil
        value.attemptedLinkID = nil
        value.clientID = UUID().uuidString
        app.drafts[conversationID] = value
      }
      throw error
    }
  }
  private func refresh() async {
    if conversation == nil {
      if app.openingConversation?.id == conversationID {
        conversation = app.openingConversation
        app.openingConversation = nil
      } else {
        conversation = await app.api?.cached("/conversations/\(conversationID)")
      }
    }
    if messages.isEmpty,
      let cached: Page<Message> = await app.api?.cached(
        "/conversations/\(conversationID)/messages", query: ["limit": "30"])
    {
      messages = cached.items
      cursor = cached.nextCursor
    }
    loading = conversation == nil
    error = nil
    do {
      async let detail: Conversation? = app.api?.request("/conversations/\(conversationID)")
      var all: [Message] = []
      var next: String?
      for _ in 0..<pageCount {
        var query = ["limit": "30"]
        query["cursor"] = next
        guard
          let page: Page<Message> = try await app.api?.request(
            "/conversations/\(conversationID)/messages", query: query)
        else { break }
        all += page.items
        next = page.nextCursor
        if next == nil { break }
      }
      try Task.checkCancellation()
      messages = all
      cursor = next
      conversation = try await detail
      if let newest = all.first, scenePhase == .active {
        let _: Success? = try await app.api?.request(
          "/conversations/\(conversationID)/read", method: "POST",
          body: ["messageId": .string(newest.id)])
      }
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
    }
    loading = false
  }
  private func more() async throws {
    guard let cursor else { return }
    if let page: Page<Message> = try await app.api?.request(
      "/conversations/\(conversationID)/messages", query: ["cursor": cursor, "limit": "30"])
    {
      messages += page.items
      self.cursor = page.nextCursor
      pageCount += 1
    }
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
