import IndexCore
import SwiftUI

extension View {
  func indexPage() -> some View { self.padding(.horizontal, 20).background(.black) }
  func outlineCard() -> some View {
    self.padding(.horizontal, 14).overlay(
      RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.2), lineWidth: 1))
  }
  func ghostInput() -> some View { self.textFieldStyle(.plain).padding(.vertical, 13) }
}
struct PageHeading: View {
  let title: String
  var messages = false
  @Environment(AppModel.self) private var app
  var body: some View {
    HStack {
      Text(title).font(.system(size: 38, weight: .semibold, design: .serif)).minimumScaleFactor(
        0.75)
      Spacer()
      if messages {
        Button {
          app.path.append(.messages)
        } label: {
          Image(systemName: "bubble.right").font(.title2).overlay(alignment: .topTrailing) {
            if app.unreadMessages > 0 { Circle().frame(width: 6, height: 6) }
          }
        }.accessibilityLabel("Messages").frame(width: 44, height: 44)
      }
    }.padding(.vertical, 12)
  }
}
struct PersonAvatar: View {
  let person: Person
  var size: CGFloat = 36
  private var color: Color {
    let colors: [Color] = [.indigo, .teal, .purple, .orange, .pink, .green]
    return colors[person.id.utf8.reduce(0) { ($0 + Int($1)) % colors.count }]
  }
  var body: some View {
    ZStack {
      Circle().fill(color.opacity(0.8))
      Text(person.initials).font(.system(size: size * 0.3, weight: .medium))
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
        Text(person.name).font(.subheadline)
        Text("@" + person.label).font(.caption).foregroundStyle(.secondary)
      }
      Spacer()
    }.contentShape(Rectangle()).padding(.vertical, 8)
  }
}
struct PillStyle: ButtonStyle {
  var selected = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.subheadline).padding(.horizontal, 15).padding(.vertical, 10)
      .background(selected ? Color.white : Color.clear, in: Capsule())
      .foregroundStyle(selected ? .black : .white)
      .overlay(Capsule().stroke(.white.opacity(selected ? 0 : 0.25)))
      .opacity(configuration.isPressed ? 0.6 : 1)
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
      if busy { ProgressView().controlSize(.small) } else { label() }
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
        Text(error).foregroundStyle(.secondary).multilineTextAlignment(.center)
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
  @Environment(AppModel.self) private var app
  var body: some View {
    HStack(spacing: 8) {
      Button {
        app.openLink(link)
      } label: {
        HStack(spacing: 12) {
          Image(systemName: link.category.symbol).frame(width: 20).foregroundStyle(.secondary)
          VStack(alignment: .leading, spacing: 3) {
            Text(link.title).font(compact ? .caption : .subheadline).lineLimit(1)
            Text(link.domain).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
      }.buttonStyle(.plain)
      LinkMenu(link: link)
    }.frame(minHeight: compact ? 42 : 58)
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
        Task {
          do {
            let path = own ? "favorite" : "star"
            let active = own ? link.isFavorite : link.isStarred
            let _: Success? = try await app.api?.request(
              "/links/\(link.id)/\(path)", method: active ? "DELETE" : "PUT", body: [:])
            app.changed()
          } catch { app.handle(error) }
        }
      } label: {
        Label(
          own
            ? (link.isFavorite ? "Remove from Favorites" : "Add to Favorites")
            : (link.isStarred ? "Unstar" : "Star"), systemImage: own ? "heart" : "star")
      }
      Button {
        Task {
          do {
            // Only links in locked groups stay private to their owner.
            if let groupId = link.groupId {
              let group: LinkGroup? = try await app.api?.request("/groups/\(groupId)")
              guard group?.visibility == .public else {
                app.error = "Links in locked groups cannot be forwarded."
                return
              }
            }
            app.path.append(.recipients(link))
          } catch { app.handle(error) }
        }
      } label: {
        Label("Forward", systemImage: "arrowshape.turn.up.right")
      }
      Button {
        if let url = URL(string: link.url) { openURL(url) }
      } label: {
        Label("Open website", systemImage: "arrow.up.right")
      }
      if own {
        Button {
          app.path.append(.add(Week.monday(Week.date(link.savedOn)), link.groupId, link))
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
      Image(systemName: "ellipsis").frame(width: 44, height: 44).foregroundStyle(.secondary)
    }
    .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Actions for \(link.title)")
    .confirmationDialog(
      "Delete link and its comments?", isPresented: $deleting, titleVisibility: .visible
    ) {
      Button("Delete link", role: .destructive) {
        Task {
          do {
            let _: Success? = try await app.api?.request("/links/\(link.id)", method: "DELETE")
            if app.path.last == .link(link.id) { app.path.removeLast() }
            app.changed()
          } catch { app.handle(error) }
        }
      }
    }
  }
}
