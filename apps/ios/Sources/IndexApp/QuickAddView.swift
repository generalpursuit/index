import IndexCore
import SwiftUI

/// Uses the same duplicate-safe, idempotent share endpoint as web quick-add and the extension.
struct QuickAddView: View {
  var groupID: String? = nil
  @Environment(AppModel.self) private var app
  @Environment(\.screenVisible) private var visible
  @State private var text = ""
  @State private var draft = ShareDraft()
  private var groups: [LinkGroup] { app.store?.profileModel(app.userID).groups ?? [] }
  @State private var selected: LinkGroup?
  @State private var initialized = false
  @State private var groupsLoaded = false
  @State private var busy = false
  @State private var error: String?
  @State private var duplicate: SavedLink?
  @State private var creatingGroup = false
  @State private var existingToOpen: SavedLink?
  @FocusState private var focused: Bool
  private var unavailable: Bool {
    (groupID != nil && !initialized) || (groupsLoaded && selected.map { chosen in
      !groups.contains { $0.id == chosen.id }
    } == true)
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      LinkRowLayout {
        HStack(spacing: 12) {
          Group {
            if busy { ProgressView().controlSize(.mini) }
            else { RoundedRectangle(cornerRadius: 2).stroke(IndexPalette.subtleForeground, lineWidth: 1).frame(width: 7, height: 7) }
          }.frame(width: 32)
          TextField(busy ? "Fetching title…" : "Enter a link", text: Binding(get: { busy ? "" : text }, set: { text = $0 }))
            .textFieldStyle(.plain).font(IndexFont.sans(16)).focused($focused)
            .autocorrectionDisabled().submitLabel(.go).disabled(busy || unavailable)
            #if os(iOS)
              .keyboardType(.URL).textInputAutocapitalization(.never)
            #endif
            .accessibilityLabel("Enter a link to add it to \(Week.label(Week.monday()))")
            .onSubmit { Task { await save() } }
            .onChange(of: text) { old, new in
              // A complete paste saves immediately; typed URLs wait for Return.
              if new.count - old.count > 1, ShareDraft.validURL(new) != nil {
                Task { await save() }
              }
            }
        }
        Menu {
          Button("Your links") { selected = nil; initialized = true }
          ForEach(groups.filter { $0.kind == "custom" }) { group in
            Button { selected = group; initialized = true } label: {
              Label(group.name, systemImage: group.visibility == .private ? "lock" : selected == nil ? "link" : "folder")
            }
          }
          Divider()
          Button("Create group", systemImage: "plus") { creatingGroup = true }
        } label: {
          HStack(spacing: 6) {
            Image(systemName: (selected?.visibility ?? app.profile?.profileVisibility) == .private ? "lock" : "globe")
              .font(.system(size: 14))
            Text(selected?.name ?? "Your links").lineLimit(1)
          }.font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
            .frame(minHeight: 44)
        }.disabled(busy).accessibilityLabel("Save destination: \(selected?.name ?? "Your links")")
      }.frame(minHeight: 48)
      if unavailable && groupsLoaded {
        Text("This group is unavailable. Choose a destination before saving.")
          .font(IndexFont.sans(12)).foregroundStyle(IndexPalette.destructive).padding(.vertical, 8)
      }
      if let error {
        Text(error).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.destructive).padding(.vertical, 8)
      }
    }
    #if os(iOS)
    .toolbar {
      ToolbarItemGroup(placement: .keyboard) {
        if visible && focused {
          Spacer()
          Button("Done") { focused = false }
            .accessibilityHint("Dismisses the keyboard without saving the link")
        }
      }
    }
    #endif
    .onChange(of: visible) { _, visible in
      // Tab roots stay mounted, but their inputs must not keep the keyboard open.
      if !visible { focused = false }
    }
    .task(id: app.userID) { await loadGroups() }
    .sheet(isPresented: $creatingGroup) {
      GroupEditorView { group in
        app.store?.created(group); selected = group; initialized = true
      }.indexSheetStyle().presentationDetents([.height(360), .large])
    }
    .sheet(item: $duplicate, onDismiss: {
      guard let link = existingToOpen else { return }
      existingToOpen = nil
      guard link.ownerId == app.userID else { return }
      app.openLink(link)
    }) { link in
      VStack(alignment: .leading, spacing: 20) {
        PageHeading(title: "Already saved")
        Text("You already saved \(link.title). Save again to add it to this week.")
          .foregroundStyle(IndexPalette.subtleForeground)
        Button("View existing") { existingToOpen = link; duplicate = nil }.buttonStyle(PillStyle())
        Button {
          duplicate = nil
          Task { await save(again: true) }
        } label: { Text("Save again").frame(maxWidth: .infinity) }
          .buttonStyle(PillStyle(selected: true))
      }.padding(20).indexSheetStyle().presentationDetents([.height(300), .large])
    }
  }
  private func loadGroups() async {
    do {
      try await app.store?.refreshGroups()
      try Task.checkCancellation()
      groupsLoaded = true
      if !initialized {
        selected = groups.first { $0.id == groupID }
        initialized = groupID == nil || selected != nil
      } else if let selected, let current = groups.first(where: { $0.id == selected.id }) {
        self.selected = current
      }
    } catch is CancellationError {} catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
      if case APIError.emailNotVerified = error { app.handle(error) }
    }
  }
  private func save(again: Bool = false) async {
    guard !busy, !unavailable, let api = app.api else { return }
    let account = app.userID
    busy = true; error = nil
    defer { busy = false }
    do {
      draft.url = text
      draft.groupID = selected?.id
      let body = try draft.body(accountID: account, saveAgain: again)
      let result: ShareResult = try await api.request("/links/share", method: "POST", body: body)
      guard account == app.userID else { return }
      if result.status == "existing" { duplicate = result.link; return }
      text = ""; draft = ShareDraft(); focused = false
      app.undoLink = result.link
      app.store?.added(result.link)
    } catch is CancellationError {} catch {
      guard account == app.userID else { return }
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
      if case APIError.emailNotVerified = error { app.handle(error) }
    }
  }
}

struct SavedLinkToast: View {
  @Environment(AppModel.self) private var app
  var body: some View {
    if let link = app.undoLink {
      HStack(spacing: 24) {
        Text("Link added")
        AsyncButton {
          guard app.userID == link.ownerId else { return }
          try await app.store?.deleteLink(link)
          if app.undoLink?.id == link.id { app.undoLink = nil }
        } label: { Text("Undo").font(IndexFont.sans(13, weight: .semibold)) }
          .buttonStyle(.plain)
      }.font(IndexFont.sans()).padding(.horizontal, 20).padding(.vertical, 14)
        .background(IndexPalette.card, in: Capsule())
        .overlay(Capsule().stroke(IndexPalette.border))
        .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
        .accessibilityElement(children: .contain)
        .task(id: link.id) {
          do { try await Task.sleep(for: .seconds(8)) } catch { return }
          if app.undoLink?.id == link.id { app.undoLink = nil }
        }
    }
  }
}
