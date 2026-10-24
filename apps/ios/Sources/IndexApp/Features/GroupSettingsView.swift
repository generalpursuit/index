import IndexCore
import IndexUI
import SwiftUI

struct GroupSettingsView: View {
  @Environment(AppModel.self) private var app
  private var groups: [LinkGroup] {
    (app.store?.profileModel(app.userID).groupsLoaded == false && error == nil ? (0..<3).map(ContentPlaceholder.group) : (app.store?.profileModel(app.userID).groups ?? [])).sorted { $0.kind == $1.kind ? $0.name < $1.name : $0.kind < $1.kind }
  }
  @State private var error: String?
  @State private var creating = false
  @State private var editing: LinkGroup?
  var body: some View {
    let loading = app.store?.profileModel(app.userID).groupsLoaded == false && error == nil
    VStack(spacing: 0) {
      if let error { RequestError(error: error, retry: { await load() }).settingsRow() }
      ForEach(groups.filter { $0.kind != "custom" } + groups.filter { $0.kind == "custom" }) { group in
        GroupRow(group: group) { editing = group }.calmPlaceholder(active: loading)
      }
      Button { creating = true } label: {
        HStack(spacing: 8) {
          Image(systemName: "plus").font(.system(size: 13)).accessibilityHidden(true)
          Text("New group")
        }.font(IndexFont.sans(14)).settingsRow().contentShape(Rectangle())
      }.buttonStyle(.plain)
    }
    .task(id: app.userID) { await load() }
    .sheet(isPresented: $creating) {
      GroupEditorView().indexSheetStyle().presentationDetents([.height(360), .large])
    }
    .sheet(item: $editing) { group in
      GroupEditorView(group: group).indexSheetStyle().presentationDetents([.height(360), .large])
    }
  }
  private func load() async {
    do {
      try await app.store?.refreshGroups(force: error != nil)
      try Task.checkCancellation()
      error = nil
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
      if case APIError.emailNotVerified = error { app.handle(error) }
    }
  }
}

/// Custom groups can be locked and edited. Favorites and Starred are never locked here:
/// Favorites follows each link's own group, Starred is always private.
private struct GroupRow: View {
  let group: LinkGroup
  let edit: () -> Void
  @Environment(AppModel.self) private var app
  @State private var confirming = false
  @State private var pending = false
  @State private var error: String?
  @AccessibilityFocusState private var errorFocused: Bool
  private var locked: Bool { group.visibility == .private }
  var body: some View {
    SettingsRow {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 8) {
          if group.kind != "custom" {
            Image(systemName: group.kind == "favorites" ? "heart" : "star").font(.system(size: 13))
              .accessibilityHidden(true)
          }
          Text(group.name).font(IndexFont.sans(14))
        }
        if let error { Text(error).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.destructive).accessibilityFocused($errorFocused) }
      }
    } control: {
      HStack(spacing: 0) {
        if let count = group.linkCount {
          Text(count == 1 ? "1 link" : "\(count) links").font(IndexFont.sans(12))
            .foregroundStyle(IndexPalette.subtleForeground).padding(.trailing, 4)
        }
        if group.kind == "custom" {
          GroupLockControl(locked: locked, name: group.name, disabled: pending) { _ in
            error = nil
            confirming = true
          }
          Button(action: edit) {
            Image(systemName: "pencil").frame(width: 44, height: 44)
          }.accessibilityLabel("Edit \(group.name)")
        } else {
          // Keeps link counts in line with those of groups that have the two buttons.
          Color.clear.frame(width: 88, height: 44)
        }
      }
    }
    .alert(locked ? "Unlock group?" : "Lock group?", isPresented: $confirming) {
      Button("Cancel", role: .cancel) {}
      Button(locked ? "Unlock group" : "Lock group") { save() }
    } message: { Text(GroupDraft.privacyDescription(locked: !locked)) }
  }
  private func save() {
    guard !pending, group.kind == "custom", let store = app.store else { return }
    pending = true
    let account = app.userID
    Task { @MainActor in
      defer { pending = false }
      do {
        _ = try await store.editGroup(group, name: group.name, visibility: locked ? .public : .private)
        guard account == app.userID else { return }
      } catch is CancellationError { return } catch {
        guard account == app.userID else { return }
        self.error = GroupDraft.saveError(error)
        errorFocused = true
        if case APIError.unauthenticated = error { app.handle(error) }
        if case APIError.emailNotVerified = error { app.handle(error) }
      }
    }
  }
}
