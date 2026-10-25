import IndexCore
import SwiftUI

/// Shared by the app and the Share extensions, so both use the same controls.
public struct PillStyle: ButtonStyle {
  var selected = false
  var compact = false
  @Environment(\.isEnabled) private var enabled
  public init(selected: Bool = false, compact: Bool = false) {
    self.selected = selected; self.compact = compact
  }
  public func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(IndexTypography.sans(compact ? 12 : 13, weight: .medium))
      .padding(.horizontal, compact ? 14 : 16).padding(.vertical, compact ? 8 : 11)
      .background(selected ? IndexPalette.primary : Color.clear, in: Capsule())
      .foregroundStyle(selected ? IndexPalette.primaryForeground : IndexPalette.foreground)
      .tint(selected ? IndexPalette.primaryForeground : IndexPalette.foreground)
      .overlay(Capsule().stroke(IndexPalette.input.opacity(selected ? 0 : 1)))
      .opacity(!enabled ? 0.4 : configuration.isPressed ? 0.6 : 1)
  }
}

/// A titled container of rows, like the iOS Settings app. Each row is laid out with `settingsRow()`.
public struct SettingsGroup<Content: View>: View {
  var title: String?
  /// Follows the title, for example where the settings are saved.
  var note: String?
  var footer: String?
  @ViewBuilder var content: Content
  public init(title: String? = nil, note: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
    self.title = title; self.note = note; self.footer = footer; self.content = content()
  }
  public var body: some View {
    let shape = RoundedRectangle(cornerRadius: 16)
    VStack(alignment: .leading, spacing: 7) {
      if let title {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(title).font(IndexTypography.mono(11)).tracking(0.77).textCase(.uppercase)
            .foregroundStyle(IndexPalette.subtleForeground)
          if let note {
            Text(note).font(IndexTypography.sans(12)).foregroundStyle(IndexPalette.subtleForeground.opacity(0.75))
          }
        }.padding(.horizontal, 4)
          .accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
      }
      VStack(spacing: 0) { content }
        // Every row draws a hairline above itself. The first one lies outside the clip, so only
        // rows that follow another row are separated; iOS 17 can't enumerate the rows instead.
        .padding(.top, -1)
        .clipShape(shape)
        .overlay(shape.strokeBorder(IndexPalette.border, lineWidth: 1))
      if let footer {
        Text(footer).font(IndexTypography.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
          .padding(.horizontal, 4)
      }
    }
  }
}

public extension View {
  /// Lays out content as a row of a `SettingsGroup`, below a hairline.
  func settingsRow() -> some View {
    padding(.horizontal, 16).padding(.vertical, 9)
      .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
      .overlay(alignment: .top) { Rectangle().fill(IndexPalette.border).frame(height: 1) }
  }
}

public struct SearchField: View {
  let placeholder: String
  @Binding var text: String
  public init(placeholder: String, text: Binding<String>) {
    self.placeholder = placeholder; _text = text
  }
  public var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "magnifyingglass").font(.system(size: 18)).foregroundStyle(IndexPalette.subtleForeground)
      TextField(placeholder, text: $text).textFieldStyle(.plain).font(IndexTypography.sans(16))
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
        #endif
      if !text.isEmpty {
        Button { text = "" } label: { Image(systemName: "xmark").frame(width: 28, height: 28) }
          .buttonStyle(.plain).accessibilityLabel("Clear search")
      }
    }.padding(.horizontal, 14).frame(minHeight: 44)
      .overlay(RoundedRectangle(cornerRadius: 10).stroke(IndexPalette.border, lineWidth: 1))
  }
}

public struct CategoryMark: View {
  let category: IndexCore.Category
  public init(category: IndexCore.Category) { self.category = category }
  public var body: some View {
    RoundedRectangle(cornerRadius: 2).fill(IndexPalette.category(category))
      .frame(width: 8, height: 8).accessibilityHidden(true)
  }
}
