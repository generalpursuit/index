import SwiftUI
import IndexCore

/// Shared by GroupEditorView and both extensions. The returned server group selects directly.
public struct GroupCreationForm: View {
  let api: APIClient
  let onCancel: () -> Void
  let onCreated: (LinkGroup) -> Void
  let onAuthError: (Error) -> Void
  let onPendingChange: (Bool) -> Void
  @State private var draft = GroupDraft()
  @State private var pending = false
  @State private var error: String?
  @State private var operation: Task<Void, Never>?
  @FocusState private var focused: Bool
  public init(api: APIClient, onCancel: @escaping () -> Void, onCreated: @escaping (LinkGroup) -> Void,
              onAuthError: @escaping (Error) -> Void = { _ in }, onPendingChange: @escaping (Bool) -> Void = { _ in }) {
    self.api = api; self.onCancel = onCancel; self.onCreated = onCreated
    self.onAuthError = onAuthError; self.onPendingChange = onPendingChange
  }
  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Create group").font(.title2.bold())
        HStack {
          TextField("Group name", text: $draft.name).textFieldStyle(.roundedBorder).focused($focused).disabled(pending)
            .onSubmit { save() }
          GroupLockControl(locked: draft.locked, disabled: pending) { draft.locked = $0 }
        }
        Text(GroupDraft.privacyDescription(locked: draft.locked)).font(.subheadline).foregroundStyle(IndexPalette.mutedForeground)
        if let error { Text(error).foregroundStyle(IndexPalette.destructive).accessibilityAddTraits(.isStaticText) }
        HStack {
          Button("Cancel", action: onCancel).disabled(pending)
          Spacer()
          Button(pending ? "Creating…" : "Create", action: save).disabled(pending)
            .buttonStyle(.borderedProminent).tint(IndexPalette.primary).foregroundStyle(IndexPalette.primaryForeground)
        }
      }.padding(20)
    }.background(IndexPalette.background).foregroundStyle(IndexPalette.foreground)
      .interactiveDismissDisabled(pending).task { focused = true }
      .onDisappear { operation?.cancel(); operation = nil }
  }
  private func save() {
    guard !pending else { return }
    if let invalid = draft.validationError { error = invalid; focused = true; return }
    pending = true; error = nil; onPendingChange(true)
    operation = Task { @MainActor in
      defer { pending = false; onPendingChange(false) }
      do {
        let group: LinkGroup = try await api.request("/groups", method: "POST", body: draft.body)
        try Task.checkCancellation()
        onCreated(group)
      } catch is CancellationError {} catch {
        self.error = GroupDraft.saveError(error); onAuthError(error)
      }
    }
  }
}
