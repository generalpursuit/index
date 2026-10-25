import SwiftUI
import IndexCore
import IndexUI

/// Real platform extension UI. Destinations stay inside Index, never OS suggested recipients.
/// Groups are created in the app; the panel only chooses one, using the app's Settings-style rows.
public struct SharePanel: View {
  @Bindable var model: ShareModel
  let finish: () -> Void
  let cancel: () -> Void
  @State private var search = ""
  /// Below this many groups the whole list fits without searching.
  private static let searchThreshold = 8
  public init(model: ShareModel, finish: @escaping () -> Void, cancel: @escaping () -> Void) {
    self.model = model; self.finish = finish; self.cancel = cancel
  }

  /// What the panel shows, in order of precedence.
  private enum Stage {
    case saved(SavedLink), existing(SavedLink), restricted(String), duplicate(SavedLink), choosing, connecting
  }
  private var stage: Stage {
    if let result = model.result, result.status == "saved" { return .saved(result.link) }
    if let existing = model.existing { return .existing(existing) }
    if let restricted = model.restricted { return .restricted(restricted) }
    if let result = model.result, result.status == "existing" { return .duplicate(result.link) }
    return model.profile == nil ? .connecting : .choosing
  }

  public var body: some View {
    let stage = stage
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        heading(stage)
        content(stage)
      }.padding(20)
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        if let error = model.error {
          Text(error).font(IndexTypography.sans(13)).foregroundStyle(IndexPalette.destructive).textSelection(.enabled)
        }
        actions(stage)
      }.padding(.horizontal, 20).padding(.vertical, 12).background(IndexPalette.surface)
    }
    .frame(minWidth: 280, idealWidth: 380)
    .scrollIndicators(.hidden)
    .font(IndexTypography.sans()).foregroundStyle(IndexPalette.foreground)
    .background(IndexPalette.surface).tint(IndexPalette.foreground)
    .task { await model.connect() }.onDisappear { model.cancel() }
  }

  private func heading(_ stage: Stage) -> some View {
    let title = switch stage {
    case .saved: "Saved"
    case .existing(let link): link.title
    case .duplicate: "Already saved"
    case .restricted, .choosing, .connecting: "Save to Index"
    }
    return HStack(spacing: 4) {
      Text(title).font(IndexTypography.serif(26)).tracking(-0.39)
        .frame(maxWidth: .infinity, alignment: .leading).accessibilityAddTraits(.isHeader)
      Button {
        // Once saved, closing completes the request instead of cancelling it.
        if case .saved = stage { finish() } else { cancel() }
      } label: {
        Image(systemName: "xmark").font(.system(size: 18)).frame(width: 44, height: 44).contentShape(Rectangle())
      }.buttonStyle(.plain).accessibilityLabel("Close")
    }.frame(minHeight: 44)
  }

  @ViewBuilder private func content(_ stage: Stage) -> some View {
    switch stage {
    case .saved(let link):
      SettingsGroup(footer: "Added to \(destinationName(of: link)) in \(savedWeek(link)).") { linkRow(link) }
    case .existing(let link):
      VStack(alignment: .leading, spacing: 8) {
        Text(link.url).font(IndexTypography.mono(12)).foregroundStyle(IndexPalette.subtleForeground)
          .textSelection(.enabled).lineLimit(4)
        Text("Saved in \(savedWeek(link))").font(IndexTypography.sans(13)).foregroundStyle(IndexPalette.subtleForeground)
        if let description = link.description { Text(description).font(IndexTypography.sans(15)).padding(.top, 8) }
      }
    case .duplicate(let link):
      Text("You saved this in \(savedWeek(link)). Save again to add another copy to this week.")
        .font(IndexTypography.sans(15)).foregroundStyle(IndexPalette.mutedForeground)
      SettingsGroup { linkRow(link) }
    case .restricted(let message):
      linkField
      VStack(alignment: .leading, spacing: 6) {
        Text(message).font(IndexTypography.sans(14))
        Text("Open Index to sign in or verify your email, then return here and retry. Your link stays here while this panel is open.")
          .font(IndexTypography.sans(13)).foregroundStyle(IndexPalette.subtleForeground)
      }
    case .choosing:
      linkField
      destinations
    case .connecting:
      linkField
      if model.busy { ProgressView().frame(maxWidth: .infinity).accessibilityLabel("Loading") }
    }
  }

  @ViewBuilder private func actions(_ stage: Stage) -> some View {
    switch stage {
    case .saved:
      HStack(spacing: 10) {
        pill(model.busy ? "Undoing…" : "Undo") { Task { if await model.undo() { cancel() } } }
        pill("Done", primary: true, action: finish)
      }.disabled(model.busy)
    case .existing:
      pill("Back") { model.existing = nil }
    case .duplicate:
      HStack(spacing: 10) {
        pill("View existing") { model.viewExisting() }
        pill(model.busy ? "Saving…" : "Save again", primary: true) { model.save(again: true) }
      }.disabled(model.busy || model.destinationUnavailable)
    case .restricted:
      pill("Retry", primary: true) { Task { await model.connect() } }.disabled(model.busy)
    case .choosing:
      pill(model.busy ? "Saving…" : "Save", primary: true) { model.save() }
        .disabled(model.busy || model.extracting || model.destinationUnavailable || ShareDraft.validURL(model.draft.url) == nil)
    case .connecting:
      if !model.busy { pill("Retry", primary: true) { Task { await model.connect() } } }
    }
  }

  /// The shared link as an editable quick-add row: a hollow marker until it is saved.
  private var linkField: some View {
    SettingsGroup(footer: model.draft.url.isEmpty ? model.inputIssue : nil) {
      HStack(spacing: 12) {
        Group {
          if model.extracting { ProgressView().controlSize(.mini) }
          else { RoundedRectangle(cornerRadius: 2).stroke(IndexPalette.subtleForeground, lineWidth: 1).frame(width: 7, height: 7) }
        }.frame(width: 16)
        TextField("Enter a link", text: $model.draft.url).textFieldStyle(.plain).font(IndexTypography.sans(15))
          .autocorrectionDisabled()
          #if os(iOS)
            .keyboardType(.URL).textInputAutocapitalization(.never).submitLabel(.go)
          #endif
          .onSubmit { model.save() }
          .accessibilityLabel("Shared link").disabled(model.busy || model.extracting)
      }.settingsRow()
    }
  }

  @ViewBuilder private var destinations: some View {
    let showsYourLinks = matches("Your links")
    let groups = model.groups.filter { matches($0.name) }
    if model.groups.count >= Self.searchThreshold {
      SearchField(placeholder: "Search groups", text: $search)
    }
    SettingsGroup(title: "Save to", note: Week.label(Week.monday()),
                  footer: model.selected?.visibility == .private ? "Only you can see this link." : "Visible to anyone who can see your profile.") {
      if showsYourLinks {
        destination("Your links", locked: model.profile?.profileVisibility == .private, selected: model.selected == nil) { model.select(nil) }
      }
      ForEach(groups) { group in
        destination(group.name, locked: group.visibility == .private, selected: model.selected?.id == group.id) { model.select(group) }
      }
      if !showsYourLinks && groups.isEmpty {
        Text("No matching groups").foregroundStyle(IndexPalette.subtleForeground).font(IndexTypography.sans(14)).settingsRow()
      }
    }
  }

  private func matches(_ name: String) -> Bool { search.isEmpty || name.localizedCaseInsensitiveContains(search) }

  private func destination(_ name: String, locked: Bool, selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: locked ? "lock" : "globe").font(.system(size: 14))
          .foregroundStyle(IndexPalette.subtleForeground).frame(width: 20)
        Text(name).font(IndexTypography.sans(14)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
        if selected { Image(systemName: "checkmark").font(.system(size: 14, weight: .medium)) }
      }.settingsRow().contentShape(Rectangle())
    }.buttonStyle(.plain)
      .accessibilityLabel(name + (locked ? ", Locked" : ", Unlocked"))
      .accessibilityAddTraits(selected ? .isSelected : []).disabled(model.busy)
  }

  private func linkRow(_ link: SavedLink) -> some View {
    HStack(spacing: 12) {
      CategoryMark(category: link.category)
      Text(link.title).font(IndexTypography.sans(15)).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
      Text(link.domain).font(IndexTypography.sans(13)).foregroundStyle(IndexPalette.subtleForeground)
        .lineLimit(1).frame(maxWidth: 120, alignment: .trailing).fixedSize(horizontal: true, vertical: false)
    }.settingsRow()
  }

  private func pill(_ title: String, primary: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) { Text(title).frame(maxWidth: .infinity) }.buttonStyle(PillStyle(selected: primary))
  }

  private func destinationName(of link: SavedLink) -> String {
    link.groupId.flatMap { id in model.groups.first { $0.id == id }?.name } ?? "Your links"
  }

  /// "Week 41", with the year when it isn't this one.
  private func savedWeek(_ link: SavedLink) -> String {
    let year = Week.calendar.component(.yearForWeekOfYear, from: Week.date(link.savedOn))
    let current = Week.calendar.component(.yearForWeekOfYear, from: Date())
    return Week.label(link.savedOn) + (year == current ? "" : " of \(year)")
  }
}
