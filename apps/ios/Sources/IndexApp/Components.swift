import IndexCore
import SwiftUI

extension View {
  func indexPage() -> some View { modifier(IndexPageStyle()) }
  func ghostInput(background: Color = IndexPalette.muted) -> some View {
    self.textFieldStyle(.plain).font(IndexFont.sans(16)).padding(.horizontal, 14)
      .padding(.vertical, 11).frame(minHeight: 44)
      .background(background, in: RoundedRectangle(cornerRadius: 10))
      .overlay(RoundedRectangle(cornerRadius: 10).stroke(IndexPalette.input, lineWidth: 1))
  }
}
struct PageHeading: View {
  let title: String
  @Environment(AppModel.self) private var app
  @Environment(\.indexSheet) private var isSheet
  var body: some View {
    HStack(alignment: .center, spacing: 4) {
      if !isSheet && !app.navigation.path.isEmpty { BackButton() }
      Text(title).font(IndexFont.serif(isSheet ? 26 : 44, relativeTo: isSheet ? .title : .largeTitle))
        .tracking(isSheet ? -0.39 : -0.66).frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityAddTraits(.isHeader)
      Spacer()
      if isSheet { SheetCloseButton() }
    }.frame(minHeight: 44)
  }
}
struct PersonAvatar: View {
  let person: Person
  var size: CGFloat = 36
  var body: some View {
    ZStack {
      Circle().fill(IndexPalette.avatarBackground(for: person.id))
      Text(person.initials.uppercased()).foregroundStyle(IndexPalette.avatarForeground).font(IndexFont.sans(size * 0.32))
      if let image = person.image, let url = URL(string: image) {
        AsyncImage(url: url) { phase in
          if let image = phase.image { image.resizable().scaledToFill() }
        }
      }
    }.frame(width: size, height: size).clipShape(Circle()).accessibilityHidden(true)
  }
}
struct PersonRow: View {
  let person: Person
  var body: some View {
    HStack(spacing: 12) {
      PersonAvatar(person: person)
      VStack(alignment: .leading, spacing: 3) {
        Text(person.name).font(IndexFont.sans(13, weight: .medium)).lineLimit(1)
        Text("@" + person.label).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground).lineLimit(1)
      }
      Spacer()
    }.contentShape(Rectangle()).padding(.vertical, 8)
  }
}
/// The system switch always draws a white thumb, which vanishes on the app's light tint in dark
/// mode. This switch pairs primary colors like a selected pill, in either scheme.
struct IndexSwitchStyle: ToggleStyle {
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 16) {
      configuration.label.frame(maxWidth: .infinity, alignment: .leading)
      Capsule().fill(configuration.isOn ? IndexPalette.primary : IndexPalette.input)
        .frame(width: 62, height: 28)
        .overlay(alignment: configuration.isOn ? .trailing : .leading) {
          Capsule().fill(configuration.isOn ? IndexPalette.primaryForeground : .white)
            .frame(width: 38, height: 24).padding(2)
        }
        .animation(.snappy(duration: 0.2), value: configuration.isOn)
        .opacity(enabled ? 1 : 0.4)
    }
    .contentShape(Rectangle())
    .onTapGesture { configuration.isOn.toggle() }
    .accessibilityRepresentation {
      Toggle(isOn: configuration.$isOn) { configuration.label }.toggleStyle(.switch)
    }
  }
}
struct AsyncButton<Label: View>: View {
  let action: () async throws -> Void
  @ViewBuilder let label: () -> Label
  @State private var busy = false
  @Environment(AppModel.self) private var app
  var body: some View {
    let generation = app.session.generation
    Button {
      busy = true
      Task {
        defer { busy = false }
        guard generation == app.session.generation else { return }
        do { try await action() } catch { if generation == app.session.generation { app.handle(error) } }
      }
    } label: {
      ZStack {
        label().opacity(busy ? 0 : 1)
        if busy { ProgressView().controlSize(.small) }
      }
    }
    .disabled(busy)
  }
}
struct RequestError: View {
  let error: String?
  var retry: (() async -> Void)? = nil
  var body: some View {
    if let error {
      VStack(spacing: 12) {
        Text(error).foregroundStyle(IndexPalette.subtleForeground).multilineTextAlignment(.center)
        if let retry { Button("Try again") { Task { await retry() } }.buttonStyle(PillStyle()) }
      }.frame(maxWidth: .infinity).padding()
    }
  }
}
struct LoadMore: View {
  let hasMore: Bool
  let action: () async throws -> Void
  var body: some View {
    if hasMore {
      AsyncButton(action: action) { Text("Load more") }.buttonStyle(PillStyle()).padding(8).frame(
        maxWidth: .infinity)
    }
  }
}
struct LinkRow: View {
  let link: SavedLink
  var compact = false
  var locked = false
  @Environment(AppModel.self) private var app
  @ScaledMetric private var rowHeight: CGFloat = 46
  var body: some View {
    LinkRowLayout {
      Button {
        app.openLink(link)
      } label: {
        HStack(spacing: 12) {
          CategoryMark(category: link.category).frame(width: 32)
          Text(link.title).font(IndexFont.sans(compact ? 12 : 13)).lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
          if locked { Image(systemName: "lock").font(.system(size: 11)).foregroundStyle(IndexPalette.subtleForeground) }
        }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
          .frame(minHeight: compact ? max(36, rowHeight - 10) : rowHeight)
      }.buttonStyle(.plain)
        .accessibilityLabel(link.title + (locked ? ", locked group" : ""))
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.15).onEnded { _ in app.preload(link) })
      if let url = URL(string: link.url) {
        Link(destination: url) {
          HStack(spacing: 4) {
            Text(link.domain).lineLimit(1).truncationMode(.tail)
            Image(systemName: "arrow.up.right").font(.system(size: compact ? 10 : 11))
          }.font(IndexFont.sans(compact ? 10 : 11)).foregroundStyle(IndexPalette.subtleForeground)
            .frame(minHeight: compact ? max(36, rowHeight - 10) : rowHeight)
        }.accessibilityLabel("Open \(link.domain) in browser")
      }
    }
  }
}
/// What the link is, where it lives, and whether you keep it: your own links are Favorites
/// (a heart), other people's are starred.
struct LinkLabel: View {
  let link: SavedLink
  let group: LinkGroup?
  @Environment(AppModel.self) private var app
  private var own: Bool { link.ownerId == app.userID }
  private var kept: Bool { own ? link.isFavorite : link.isStarred }
  var body: some View {
    HStack(spacing: 8) {
      if link.category != .uncategorized {
        CategoryMark(category: link.category)
        Text(link.category.rawValue.uppercased())
        Text("·").accessibilityHidden(true)
      }
      if let group {
        HStack(spacing: 5) {
          if group.visibility == .private {
            Image(systemName: "lock").font(.system(size: 10)).accessibilityLabel("Locked")
          }
          Text(group.name.uppercased()).lineLimit(1)
        }
        Text("·").accessibilityHidden(true)
      }
      AsyncButton {
        try await app.store?.keep(link)
      } label: {
        Image(systemName: (own ? "heart" : "star") + (kept ? ".fill" : "")).font(.system(size: 14))
          .foregroundStyle(kept ? IndexPalette.foreground : IndexPalette.subtleForeground)
          // A full touch target that doesn't make the row taller.
          .frame(width: 44, height: 44).contentShape(Rectangle()).padding(.vertical, -12)
          .padding(.horizontal, -12)
      }.buttonStyle(.plain).accessibilityLabel(own ? "Favorite" : "Star")
        .accessibilityAddTraits(kept ? [.isToggle, .isSelected] : .isToggle)
    }.font(IndexFont.mono(11)).tracking(0.66).foregroundStyle(IndexPalette.subtleForeground)
  }
}

/// Reading is the main thing to do with a link; sharing and editing sit beside it.
struct LinkActions: View {
  let link: SavedLink
  let group: LinkGroup?
  @Environment(AppModel.self) private var app
  private var own: Bool { link.ownerId == app.userID }
  // Only links in locked groups stay private to their owner.
  private var forwardable: Bool { link.groupId == nil || group?.visibility == .public }
  var body: some View {
    HStack(spacing: 8) {
      if let url = URL(string: link.url) {
        Link(destination: url) {
          HStack(spacing: 6) {
            Text(link.domain).lineLimit(1).truncationMode(.tail)
            Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .medium))
          }.font(IndexFont.sans(13, weight: .medium)).padding(.horizontal, 16).frame(minHeight: 44)
            .foregroundStyle(IndexPalette.primaryForeground).background(IndexPalette.primary, in: Capsule())
        }.accessibilityLabel("Open \(link.domain)")
      }
      if forwardable {
        Button { app.present(.recipients(link)) } label: { ActionIcon(systemName: "arrowshape.turn.up.right") }
          .buttonStyle(.plain).accessibilityLabel("Forward")
      }
      if let shortID = link.shortId, let url = app.webURL?.appendingPathComponent(ReadableRoutes.link(shortID)) {
        ShareLink(item: url) { ActionIcon(systemName: "square.and.arrow.up") }
          .buttonStyle(.plain).accessibilityLabel("Share post")
      }
      Spacer(minLength: 0)
      if own {
        Button { app.present(.edit(link)) } label: { ActionIcon(systemName: "pencil") }
          .buttonStyle(.plain).accessibilityLabel("Edit")
      }
    }
  }
}

private struct ActionIcon: View {
  let systemName: String
  var body: some View {
    Image(systemName: systemName).font(.system(size: 15)).foregroundStyle(IndexPalette.foreground)
      .frame(width: 44, height: 44).background(IndexPalette.card, in: Circle())
      .overlay(Circle().stroke(IndexPalette.border, lineWidth: 1)).contentShape(Circle())
  }
}

/// Delay cold placeholders and hold them long enough to avoid a flash. Content keeps
/// the same view tree and layout through both transitions.
private struct CalmPlaceholder: ViewModifier {
  let active: Bool
  @State private var shown = false
  @State private var shownAt: Date?
  func body(content: Content) -> some View {
    content
      .redacted(reason: shown ? .placeholder : [])
      .opacity(active && !shown ? 0 : 1)
      .allowsHitTesting(!active && !shown)
      .accessibilityHidden(active || shown)
      .task(id: active) {
        do {
          if active {
            try await Task.sleep(for: .milliseconds(300))
            try Task.checkCancellation()
            shownAt = .now
            shown = true
          } else if let shownAt {
            let remaining = max(0, 0.4 - Date().timeIntervalSince(shownAt))
            if remaining > 0 { try await Task.sleep(for: .seconds(remaining)) }
            try Task.checkCancellation()
            shown = false
            self.shownAt = nil
          }
        } catch {}
      }
  }
}
extension View {
  func calmPlaceholder(active: Bool) -> some View { modifier(CalmPlaceholder(active: active)) }
}
