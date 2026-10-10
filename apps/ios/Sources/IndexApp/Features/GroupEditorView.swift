import IndexCore
import SwiftUI

struct GroupLockControl: View {
  let locked: Bool
  var name = "group"
  var alwaysPrivate = false
  var disabled = false
  let onChange: (Bool) -> Void
  var body: some View {
    Button { onChange(!locked) } label: {
      Image(systemName: locked || alwaysPrivate ? "lock" : "lock.open")
        .frame(width: 44, height: 44).contentShape(Rectangle())
    }
    .buttonStyle(.plain).foregroundStyle(IndexPalette.foreground)
    .disabled(disabled || alwaysPrivate)
    .accessibilityLabel(alwaysPrivate ? "\(name): Always private" : "Lock \(name)")
    .accessibilityValue(locked || alwaysPrivate ? "Locked" : "Unlocked")
    .accessibilityHint(alwaysPrivate ? "Starred is always private." : GroupDraft.privacyDescription(locked: locked))
  }
}

/// Present in a sheet or navigation destination. A save/share caller uses onCreated to select
/// the full returned group immediately; errors and cancellations never call it.
struct GroupEditorView: View {
  let onCreated: ((LinkGroup) -> Void)?
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var draft: GroupDraft
  @State private var pending = false
  @State private var error: String?
  @State private var attempted = false
  @State private var confirmingPrivacy = false
  @State private var deleting = false
  @FocusState private var nameFocused: Bool
  @AccessibilityFocusState private var errorFocused: Bool

  init(group: LinkGroup? = nil, onCreated: ((LinkGroup) -> Void)? = nil) {
    _draft = State(initialValue: GroupDraft(group: group))
    self.onCreated = onCreated
  }
  private var feedback: String? { attempted ? draft.validationError ?? error : error }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        PageHeading(title: draft.original == nil ? "New group" : "Edit group")
        VStack(alignment: .leading, spacing: 8) {
          Text("Name").font(.caption).foregroundStyle(IndexPalette.mutedForeground)
          HStack(spacing: 8) {
            TextField("Group name", text: $draft.name).ghostInput()
              .focused($nameFocused).disabled(pending || !draft.isCustom)
              .submitLabel(.done).onSubmit { submit() }
              .onChange(of: draft.name) { _, _ in error = nil }
            GroupLockControl(locked: draft.visibility == .private, alwaysPrivate: draft.alwaysPrivate, disabled: pending) {
              draft.locked = $0
            }
          }
          Text(GroupDraft.privacyDescription(locked: draft.visibility == .private))
            .font(.subheadline).foregroundStyle(IndexPalette.mutedForeground)
          if draft.alwaysPrivate {
            Text("Always private").font(.caption).foregroundStyle(IndexPalette.mutedForeground)
          }
          if let feedback {
            Text(feedback).font(.subheadline).foregroundStyle(IndexPalette.destructive)
              .accessibilityFocused($errorFocused)
          }
        }
        HStack {
          Button("Cancel") { dismiss() }.disabled(pending)
          Spacer()
          Button(action: submit) {
            HStack {
              if pending { ProgressView().tint(IndexPalette.primaryForeground) }
              Text(pending ? "Saving…" : draft.original == nil ? "Create" : "Save")
            }.padding(.horizontal, 18).padding(.vertical, 12)
              .background(IndexPalette.primary, in: Capsule()).foregroundStyle(IndexPalette.primaryForeground)
          }.buttonStyle(.plain).disabled(pending)
        }
        if draft.original?.kind == "custom" {
          Button("Delete group", role: .destructive) { deleting = true }.disabled(pending)
        }
      }.padding(20)
    }
    .background(IndexPalette.background).foregroundStyle(IndexPalette.foreground)
    .interactiveDismissDisabled(pending)
    .task { nameFocused = draft.isCustom }
    .alert(draft.locked ? "Lock group?" : "Unlock group?", isPresented: $confirmingPrivacy) {
      Button("Cancel", role: .cancel) {}
      Button(draft.locked ? "Lock and save" : "Unlock and save") { save() }
    } message: { Text(GroupDraft.privacyDescription(locked: draft.locked)) }
    .confirmationDialog("Delete group?", isPresented: $deleting, titleVisibility: .visible) {
      Button("Delete group", role: .destructive) { remove() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(draft.original?.visibility == .private
        ? "Its links stay on your profile without a group. They will no longer be locked, so anyone who can see your profile will see them."
        : "Its links stay on your profile without a group.")
    }
  }
  private func submit() {
    guard !pending, !confirmingPrivacy else { return }
    attempted = true
    error = nil
    guard draft.validationError == nil else { nameFocused = true; errorFocused = true; return }
    if draft.changesPrivacy { confirmingPrivacy = true } else { save() }
  }
  private func save() {
    guard !pending, let api = app.api else { return }
    pending = true
    let account = app.userID
    Task { @MainActor in
      defer { pending = false }
      do {
        let group: LinkGroup = try await api.request(
          draft.original.map { "/groups/\($0.id)" } ?? "/groups",
          method: draft.original == nil ? "POST" : "PATCH", body: draft.body)
        guard account == app.userID else { return }
        if draft.original == nil { onCreated?(group) }
        app.changed()
        dismiss()
      } catch is CancellationError { return } catch {
        guard account == app.userID else { return }
        self.error = GroupDraft.saveError(error)
        errorFocused = true
        if case APIError.unauthenticated = error { app.handle(error) }
      }
    }
  }
  private func remove() {
    guard !pending, let group = draft.original, group.kind == "custom", let api = app.api else { return }
    pending = true
    let account = app.userID
    Task { @MainActor in
      defer { pending = false }
      do {
        let _: Success = try await api.request("/groups/\(group.id)", method: "DELETE", body: ["deleteLinks": .bool(false)])
        guard account == app.userID else { return }
        app.changed()
        dismiss()
      } catch is CancellationError { return } catch {
        guard account == app.userID else { return }
        self.error = GroupDraft.saveError(error)
        errorFocused = true
        if case APIError.unauthenticated = error { app.handle(error) }
      }
    }
  }
}
