import SwiftUI
import IndexCore
import IndexUI
#if os(iOS)
  import UIKit
#endif

typealias IndexPalette = IndexUI.IndexPalette
typealias IndexFont = IndexUI.IndexTypography
typealias IndexWordmark = IndexUI.IndexWordmark
typealias IndexSymbol = IndexUI.IndexSymbol
typealias PillStyle = IndexUI.PillStyle
typealias SettingsGroup<Content: View> = IndexUI.SettingsGroup<Content>
typealias SearchField = IndexUI.SearchField
typealias CategoryMark = IndexUI.CategoryMark

struct AppearanceSettings: View {
  @AppStorage(ThemePreference.storageKey) private var storedTheme = ThemePreference.system.rawValue
  var body: some View {
    // Pass the selection into the options as a value. Options that read the storage themselves,
    // inside the ForEach closure, kept their first selection when the preference changed.
    let selection = ThemePreference(storedValue: storedTheme)
    SettingsRow("Appearance") {
      HStack(spacing: 0) {
        ForEach([ThemePreference.system, .light, .dark], id: \.rawValue) { theme in
          Button(theme.rawValue.capitalized) { storedTheme = theme.rawValue }
            .buttonStyle(SegmentStyle(selected: selection == theme))
            .accessibilityAddTraits(selection == theme ? .isSelected : [])
        }
      }.padding(2).overlay(Capsule().strokeBorder(IndexPalette.border, lineWidth: 1))
        .accessibilityHint("Saved on this device for all accounts. System follows your device appearance.")
    }
  }
}

/// An option of a compact segmented control, selected like a pill.
private struct SegmentStyle: ButtonStyle {
  let selected: Bool
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(IndexFont.sans(12, weight: .medium))
      .padding(.horizontal, 10).padding(.vertical, 5)
      .foregroundStyle(selected ? IndexPalette.primaryForeground : IndexPalette.subtleForeground)
      .background(selected ? IndexPalette.primary : Color.clear, in: Capsule())
      .opacity(configuration.isPressed ? 0.6 : 1)
      // A full touch target that doesn't make the control taller.
      .frame(minHeight: 44).contentShape(Rectangle()).padding(.vertical, -9)
  }
}

extension View {
  /// Applies the appearance to the whole window. On iOS, `preferredColorScheme` overrides each
  /// presentation's controller separately, so an open sheet keeps the scheme it was presented
  /// with; everything presented in a window inherits that window's style as it changes.
  func windowAppearance(_ theme: ThemePreference) -> some View {
    #if os(iOS)
      background(WindowAppearance(style: theme.colorScheme.map(UIUserInterfaceStyle.init) ?? .unspecified))
    #else
      preferredColorScheme(theme.colorScheme)
    #endif
  }
}

#if os(iOS)
  private struct WindowAppearance: UIViewRepresentable {
    let style: UIUserInterfaceStyle
    func makeUIView(context: Context) -> WindowAppearanceView { WindowAppearanceView() }
    func updateUIView(_ view: WindowAppearanceView, context: Context) { view.style = style }
  }

  private final class WindowAppearanceView: UIView {
    var style = UIUserInterfaceStyle.unspecified { didSet { apply() } }
    override init(frame: CGRect) {
      super.init(frame: frame)
      isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    // The view is created before it joins its window, so the style is also applied on arrival.
    override func didMoveToWindow() {
      super.didMoveToWindow()
      apply()
    }
    private func apply() { window?.overrideUserInterfaceStyle = style }
  }
#endif
