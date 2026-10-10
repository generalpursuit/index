import IndexCore
import IndexUI
import SwiftUI

struct GroupSettingsView: View {
  @Environment(AppModel.self) private var app
  @State private var groups: [LinkGroup] = []
  @State private var loading = true
  @State private var error: String?
  @State private var creating = false
  @State private var editing: LinkGroup?
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("Groups").font(IndexFont.sans(16, weight: .medium))
        Spacer()
        Button { creating = true } label: {
          Image(systemName: "plus").frame(width: 44, height: 44)
        }.accessibilityLabel("New group")
      }
      Text("Locked lists are only yours, whoever can see your profile.")
        .font(IndexFont.sans(12)).foregroundStyle(IndexPalette.mutedForeground)
      LoadingError(error: error, loading: loading, retry: { await load() })
      ForEach(groups) { group in
        HStack {
          VStack(alignment: .leading, spacing: 3) {
            Text(group.name)
            if let count = group.linkCount {
              Text(count == 1 ? "1 link" : "\(count) links").font(IndexFont.sans(12))
                .foregroundStyle(IndexPalette.mutedForeground)
            }
          }
          Spacer()
          ManagedGroupLock(group: group)
          if group.kind == "custom" {
            Button { editing = group } label: {
              Image(systemName: "pencil").frame(width: 44, height: 44)
            }.accessibilityLabel("Edit \(group.name)")
          } else { Color.clear.frame(width: 44, height: 44).accessibilityHidden(true) }
        }
      }
    }
    .foregroundStyle(IndexPalette.foreground)
    .task(id: "\(app.userID)-\(app.revision)") { await load() }
    .sheet(isPresented: $creating) {
      GroupEditorView().indexSheetStyle().presentationDetents([.height(360), .large])
    }
    .sheet(item: $editing) { group in
      GroupEditorView(group: group).indexSheetStyle().presentationDetents([.height(360), .large])
    }
  }
  private func load() async {
    loading = groups.isEmpty
    do {
      let available = try await allGroups(api: app.api, ownerID: app.userID)
      try Task.checkCancellation()
      let order = ["favorites": 0, "custom": 1, "starred": 2]
      groups = available.sorted {
        let lhs = order[$0.kind] ?? 1, rhs = order[$1.kind] ?? 1
        return lhs == rhs ? $0.name.localizedStandardCompare($1.name) == .orderedAscending : lhs < rhs
      }
      error = nil
    } catch is CancellationError { return } catch {
      self.error = error.localizedDescription
      if case APIError.unauthenticated = error { app.handle(error) }
      if case APIError.emailNotVerified = error { app.handle(error) }
    }
    loading = false
  }
}

private struct ManagedGroupLock: View {
  let group: LinkGroup
  @Environment(AppModel.self) private var app
  @State private var confirming = false
  @State private var pending = false
  @State private var error: String?
  @AccessibilityFocusState private var errorFocused: Bool
  private var locked: Bool { group.kind == "starred" || group.visibility == .private }
  var body: some View {
    VStack(alignment: .trailing, spacing: 4) {
      GroupLockControl(locked: locked, name: group.name, alwaysPrivate: group.kind == "starred", disabled: pending) { _ in
        error = nil
        confirming = true
      }
      if let error { Text(error).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.destructive).accessibilityFocused($errorFocused) }
      if pending { ProgressView().accessibilityLabel("Saving group") }
    }
    .alert(locked ? "Unlock group?" : "Lock group?", isPresented: $confirming) {
      Button("Cancel", role: .cancel) {}
      Button(locked ? "Unlock group" : "Lock group") { save() }
    } message: { Text(GroupDraft.privacyDescription(locked: !locked)) }
  }
  private func save() {
    guard !pending, group.kind != "starred", let api = app.api else { return }
    pending = true
    let account = app.userID
    Task { @MainActor in
      defer { pending = false }
      do {
        let _: LinkGroup = try await api.request("/groups/\(group.id)", method: "PATCH",
          body: ["visibility": .string(locked ? "public" : "private")])
        guard account == app.userID else { return }
        app.changed()
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
