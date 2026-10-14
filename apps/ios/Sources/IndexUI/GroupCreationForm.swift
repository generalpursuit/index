import SwiftUI
import IndexCore

/// Shared by GroupEditorView and both extensions. The returned server group selects directly.
public struct GroupCreationForm: View {
  let api: APIClient
  let onCancel: () -> Void
  let showsCloseButton: Bool
  let onCreated: (LinkGroup) -> Void
  let onAuthError: (Error) -> Void
  let onPendingChange: (Bool) -> Void
  @State private var draft = GroupDraft()
  @State private var pending = false
  @State private var error: String?
  @State private var operation: Task<Void, Never>?
  @FocusState private var focused: Bool
  public init(api: APIClient, showsCloseButton: Bool = true, onCancel: @escaping () -> Void, onCreated: @escaping (LinkGroup) -> Void,
              onAuthError: @escaping (Error) -> Void = { _ in }, onPendingChange: @escaping (Bool) -> Void = { _ in }) {
    self.api = api; self.showsCloseButton = showsCloseButton; self.onCancel = onCancel; self.onCreated = onCreated
    self.onAuthError = onAuthError; self.onPendingChange = onPendingChange
  }
  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        HStack {
          Text("Create group").font(IndexTypography.serif(26)).accessibilityAddTraits(.isHeader)
          Spacer()
          if showsCloseButton {
            Button(action: onCancel) {
              Image(systemName: "xmark").font(.system(size: 18)).frame(width: 44, height: 44)
            }.buttonStyle(.plain).disabled(pending).accessibilityLabel("Close")
          }
        }.frame(minHeight: 44)
        HStack {
          TextField("Group name", text: $draft.name).textFieldStyle(.plain).font(IndexTypography.sans(16))
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(IndexPalette.muted, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(IndexPalette.input))
            .focused($focused).disabled(pending)
            .onSubmit { save() }
          GroupLockControl(locked: draft.locked, disabled: pending) { draft.locked = $0 }
        }
        Text(GroupDraft.privacyDescription(locked: draft.locked)).font(IndexTypography.sans(13)).foregroundStyle(IndexPalette.subtleForeground)
        if let error { Text(error).foregroundStyle(IndexPalette.destructive).accessibilityAddTraits(.isStaticText) }
        Button(action: save) {
          Text(pending ? "Creating…" : "Create").font(IndexTypography.sans(14, weight: .medium))
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(IndexPalette.primary, in: Capsule()).foregroundStyle(IndexPalette.primaryForeground)
        }.buttonStyle(.plain).disabled(pending).opacity(pending ? 0.4 : 1)
      }.padding(20)
    }.background(IndexPalette.surface).foregroundStyle(IndexPalette.foreground)
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
