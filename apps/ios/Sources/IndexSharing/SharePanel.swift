import SwiftUI
import IndexCore
import IndexUI

/// Real platform extension UI. Destinations stay inside Index, never OS suggested recipients.
public struct SharePanel: View {
  @Bindable var model: ShareModel
  let finish: () -> Void
  let cancel: () -> Void
  @State private var search = ""
  @State private var creating = false
  @State private var creatingPending = false
  public init(model: ShareModel, finish: @escaping () -> Void, cancel: @escaping () -> Void) {
    self.model = model; self.finish = finish; self.cancel = cancel
  }
  public var body: some View {
    ScrollView {
    VStack(alignment: .leading, spacing: 16) {
      HStack { Text("Save to Index").font(.title2.bold()); Spacer(); Button("Cancel", action: cancel).disabled(creatingPending) }
      if creating, let api = model.api {
        GroupCreationForm(api: api, onCancel: { creating = false }, onCreated: { group in
          model.created(group); creating = false; search = ""
        }, onAuthError: { model.handle($0) }, onPendingChange: { creatingPending = $0 })
      } else if model.result?.status == "saved" {
        Label("Saved to this week", systemImage: "checkmark.circle").font(.headline)
        Text(model.result?.link.title ?? "").lineLimit(3)
        Button("Done", action: finish).buttonStyle(.borderedProminent).foregroundStyle(IndexPalette.primaryForeground)
      } else if let existing = model.existing {
        Text(existing.title).font(.headline)
        Text(existing.url).textSelection(.enabled).lineLimit(4)
        Text("Saved \(existing.savedOn)").foregroundStyle(IndexPalette.mutedForeground)
        if let description = existing.description { ScrollView { Text(description) } }
        Button("Back to save") { model.existing = nil }
      } else {
        TextField("https://…", text: $model.draft.url).textFieldStyle(.roundedBorder)
          .accessibilityLabel("Shared link").disabled(model.busy || model.extracting || model.result != nil)
        if let restricted = model.restricted {
          Text(restricted).foregroundStyle(IndexPalette.mutedForeground)
          Text("Open Index to sign in or verify your email, then return here and retry. Your link stays here while this panel is open.").font(.subheadline)
          Button("Retry session") { Task { await model.connect() } }.disabled(model.busy)
        } else if model.profile != nil {
          Text("Save into the current week").font(.subheadline).foregroundStyle(IndexPalette.mutedForeground)
          if model.destinationUnavailable { Text("Selected group unavailable. Choose another destination.").foregroundStyle(IndexPalette.destructive) }
          TextField("Search destinations", text: $search).textFieldStyle(.roundedBorder)
          ScrollView {
            VStack(spacing: 4) {
              if search.isEmpty || "your links".contains(search.lowercased()) {
                row(name: "Your links", locked: model.profile?.profileVisibility == .private, selected: model.selected == nil) { model.select(nil) }
              }
              ForEach(model.groups.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { group in
                row(name: group.name, locked: group.visibility == .private, selected: model.selected?.id == group.id) { model.select(group) }
              }
            }
          }.frame(maxHeight: 260)
          Button("Refresh destinations") { Task { await model.connect() } }.disabled(model.busy)
          Button { creating = true } label: { Label("Create group", systemImage: "plus") }.disabled(model.busy)
          Text(model.selected?.visibility == .private ? "Only you can see this link." : "Visible to anyone who can see your profile.")
            .font(.caption).foregroundStyle(IndexPalette.mutedForeground)
          if model.result?.status == "existing" {
            Text("You already saved this link.")
            HStack {
              Button("View existing") { model.viewExisting() }
              Spacer()
              Button("Save again") { model.save(again: true) }.buttonStyle(.borderedProminent).foregroundStyle(IndexPalette.primaryForeground)
            }.disabled(model.busy || model.destinationUnavailable)
          } else {
            Button(model.busy ? "Saving…" : "Save") { model.save() }.buttonStyle(.borderedProminent).foregroundStyle(IndexPalette.primaryForeground)
              .disabled(model.busy || model.extracting || model.destinationUnavailable || ShareDraft.validURL(model.draft.url) == nil)
          }
        } else if !model.busy {
          Button("Retry connection") { Task { await model.connect() } }
        }
      }
      if let issue = model.inputIssue, model.draft.url.isEmpty { Text(issue).font(.subheadline).foregroundStyle(IndexPalette.mutedForeground) }
      if model.busy || model.extracting { ProgressView().accessibilityLabel("Loading") }
      if let error = model.error { Text(error).font(.subheadline).foregroundStyle(IndexPalette.destructive).textSelection(.enabled) }
    }.padding(20).frame(minWidth: 280, idealWidth: 380)
    }
      .foregroundStyle(IndexPalette.foreground).background(IndexPalette.background).tint(IndexPalette.primary)
      .task { await model.connect() }.onDisappear { model.cancel() }
      .interactiveDismissDisabled(creatingPending)
  }
  private func row(name: String, locked: Bool, selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: locked ? "lock" : "folder").frame(width: 32, height: 36)
        Text(name).lineLimit(2).multilineTextAlignment(.leading)
        Spacer()
        if selected { Image(systemName: "checkmark") }
      }.padding(8).contentShape(Rectangle())
    }.buttonStyle(.plain).background(selected ? IndexPalette.muted : IndexPalette.background, in: RoundedRectangle(cornerRadius: 10))
      .accessibilityLabel(name + (locked ? ", Locked" : ", Unlocked"))
      .accessibilityAddTraits(selected ? .isSelected : []).disabled(model.busy)
  }
}
