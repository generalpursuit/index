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
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("Groups").font(IndexFont.sans(16, weight: .medium))
        Spacer()
        Button { creating = true } label: {
          Image(systemName: "plus").frame(width: 44, height: 44)
        }.accessibilityLabel("New group")
      }
      Text("Lock a group to keep its links to yourself.")
        .font(IndexFont.sans(12)).foregroundStyle(IndexPalette.mutedForeground)
      RequestError(error: error, retry: { await load() })
      Group {
        // Favorites and Starred are never locked here: Favorites follows each link's own group,
        // Starred is always private.
        ForEach(groups.filter { $0.kind != "custom" }) { group in
          HStack { name(group); Spacer() }.frame(minHeight: 44)
        }
        if groups.contains(where: { $0.kind == "custom" }) {
          HStack(spacing: 10) {
            Text("YOUR GROUPS").font(IndexFont.mono(11)).tracking(0.66)
              .foregroundStyle(IndexPalette.subtleForeground)
            Rectangle().fill(IndexPalette.border).frame(height: 1)
          }.padding(.top, 4).accessibilityElement(children: .ignore)
            .accessibilityLabel("Your groups").accessibilityAddTraits(.isHeader)
          ForEach(groups.filter { $0.kind == "custom" }) { group in
            HStack {
              name(group)
              Spacer()
              ManagedGroupLock(group: group)
              Button { editing = group } label: {
                Image(systemName: "pencil").frame(width: 44, height: 44)
              }.accessibilityLabel("Edit \(group.name)")
            }
          }
        }
      }.calmPlaceholder(active: app.store?.profileModel(app.userID).groupsLoaded == false && error == nil)
    }
    .foregroundStyle(IndexPalette.foreground)
    .task(id: app.userID) { await load() }
    .sheet(isPresented: $creating) {
      GroupEditorView().indexSheetStyle().presentationDetents([.height(360), .large])
    }
    .sheet(item: $editing) { group in
      GroupEditorView(group: group).indexSheetStyle().presentationDetents([.height(360), .large])
    }
  }
  private func name(_ group: LinkGroup) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 8) {
        if group.kind != "custom" {
          Image(systemName: group.kind == "favorites" ? "heart" : "star").font(.system(size: 13))
            .accessibilityHidden(true)
        }
        Text(group.name)
      }
      if let count = group.linkCount {
        Text(count == 1 ? "1 link" : "\(count) links").font(IndexFont.sans(12))
          .foregroundStyle(IndexPalette.mutedForeground)
      }
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

private struct ManagedGroupLock: View {
  let group: LinkGroup
  @Environment(AppModel.self) private var app
  @State private var confirming = false
  @State private var pending = false
  @State private var error: String?
  @AccessibilityFocusState private var errorFocused: Bool
  private var locked: Bool { group.visibility == .private }
  var body: some View {
    VStack(alignment: .trailing, spacing: 4) {
      GroupLockControl(locked: locked, name: group.name, disabled: pending) { _ in
        error = nil
        confirming = true
      }
      if let error { Text(error).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.destructive).accessibilityFocused($errorFocused) }
    }
    .alert(locked ? "Unlock group?" : "Lock group?", isPresented: $confirming) {
      Button("Cancel", role: .cancel) {}
      Button(locked ? "Unlock group" : "Lock group") { save() }
    } message: { Text(GroupDraft.privacyDescription(locked: !locked)) }
  }
  private func save() {
    guard !pending, group.kind == "custom", let api = app.api else { return }
    pending = true
    let account = app.userID
    Task { @MainActor in
      defer { pending = false }
      do {
        _ = try await app.store?.editGroup(group, name: group.name, visibility: locked ? .public : .private)
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
