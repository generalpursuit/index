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
struct PillStyle: ButtonStyle {
  var selected = false
  var compact = false
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(IndexFont.sans(compact ? 12 : 13, weight: .medium))
      .padding(.horizontal, compact ? 14 : 16).padding(.vertical, compact ? 8 : 11)
      .background(selected ? IndexPalette.primary : Color.clear, in: Capsule())
      .foregroundStyle(selected ? IndexPalette.primaryForeground : IndexPalette.foreground)
      .tint(selected ? IndexPalette.primaryForeground : IndexPalette.foreground)
      .overlay(Capsule().stroke(IndexPalette.input.opacity(selected ? 0 : 1)))
      .opacity(!enabled ? 0.4 : configuration.isPressed ? 0.6 : 1)
  }
}
struct AsyncButton<Label: View>: View {
  let action: () async throws -> Void
  @ViewBuilder let label: () -> Label
  @State private var busy = false
  @Environment(AppModel.self) private var app
  var body: some View {
    Button {
      busy = true
      Task {
        defer { busy = false }
        do { try await action() } catch { app.handle(error) }
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
struct LoadingError: View {
  let error: String?
  let loading: Bool
  var retry: (() async -> Void)? = nil
  var body: some View {
    if loading { ProgressView().frame(maxWidth: .infinity).padding() }
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
struct LinkActions: View {
  let link: SavedLink
  @Environment(AppModel.self) private var app
  private var own: Bool { link.ownerId == app.userID }
  private var selected: Bool { own ? link.isFavorite : link.isStarred }
  var body: some View {
    HStack(spacing: 0) {
      AsyncButton {
        let path = own ? "favorite" : "star"
        let _: Success? = try await app.api?.request("/links/\(link.id)/\(path)",
          method: selected ? "DELETE" : "PUT", body: [:])
        app.changed()
      } label: {
        Image(systemName: (own ? "heart" : "star") + (selected ? ".fill" : ""))
          .font(.system(size: 20)).frame(width: 44, height: 44)
      }.buttonStyle(.plain).accessibilityLabel(own
        ? (selected ? "Remove from Favorites" : "Add to Favorites") : (selected ? "Unstar" : "Star"))
      AsyncButton {
        // A locked group cannot be forwarded, even when its owner's profile is public.
        if let groupID = link.groupId {
          let group: LinkGroup? = try await app.api?.request("/groups/\(groupID)")
          guard group?.visibility == .public else {
            app.error = "Links in locked groups cannot be forwarded."
            return
          }
        }
        app.present(.recipients(link))
      } label: {
        Image(systemName: "arrowshape.turn.up.right").font(.system(size: 20)).frame(width: 44, height: 44)
      }.buttonStyle(.plain).accessibilityLabel("Forward")
      LinkMenu(link: link)
    }.foregroundStyle(IndexPalette.subtleForeground)
  }
}

struct LinkMenu: View {
  let link: SavedLink
  @Environment(AppModel.self) private var app
  @Environment(\.openURL) private var openURL
  @State private var deleting = false
  var own: Bool { app.userID == link.ownerId }
  var body: some View {
    Menu {
      Button {
        if let url = URL(string: link.url) { openURL(url) }
      } label: {
        Label("Open website", systemImage: "arrow.up.right")
      }
      if let shortID = link.shortId, let url = app.webURL?.appendingPathComponent(ReadableRoutes.link(shortID)) {
        ShareLink(item: url) { Label("Share post", systemImage: "square.and.arrow.up") }
      }
      if own {
        Button {
          app.present(.add(Week.monday(Week.date(link.savedOn)), link.groupId, link))
        } label: {
          Label("Edit", systemImage: "pencil")
        }
        Button(role: .destructive) {
          deleting = true
        } label: {
          Label("Delete", systemImage: "trash")
        }
      }
    } label: {
      Image(systemName: "ellipsis").frame(width: 44, height: 44).foregroundStyle(IndexPalette.subtleForeground)
    }
    .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Actions for \(link.title)")
    .confirmationDialog(
      "Delete link and its comments?", isPresented: $deleting, titleVisibility: .visible
    ) {
      Button("Delete link", role: .destructive) {
        Task {
          do {
            let _: Success? = try await app.api?.request("/links/\(link.id)", method: "DELETE")
            if app.navigation.sheet == .link(link.id) { app.navigation.sheet = nil }
            if app.navigation.path.last == .link(link.id) { app.navigation.path.removeLast() }
            app.changed()
          } catch { app.handle(error) }
        }
      }
    }
  }
}
