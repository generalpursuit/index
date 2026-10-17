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

struct AppearanceSettings: View {
  @AppStorage(ThemePreference.storageKey) private var storedTheme = ThemePreference.system.rawValue
  var body: some View {
    // Pass the selection into the rows as a value. Rows that read the storage themselves, inside
    // the ForEach closure, kept their first selection when the preference changed.
    let selection = ThemePreference(storedValue: storedTheme)
    VStack(alignment: .leading, spacing: 12) {
      Text("Appearance").font(IndexFont.sans(16, weight: .medium))
      Text("Choose how Index looks on this device.")
        .font(IndexFont.sans(12)).foregroundStyle(IndexPalette.mutedForeground)
      HStack(spacing: 8) {
        ForEach([ThemePreference.system, .light, .dark], id: \.rawValue) { theme in
          Button(theme.rawValue.capitalized) { storedTheme = theme.rawValue }
            .buttonStyle(PillStyle(selected: selection == theme))
            .accessibilityAddTraits(selection == theme ? .isSelected : [])
        }
      }.padding(.top, 4)
        .accessibilityHint("Saved on this device for all accounts. System follows your device appearance.")
    }
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

struct AppIconSettings: View {
  #if os(iOS)
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedName = UIApplication.shared.alternateIconName
    @State private var changing = false
    @State private var errorMessage: String?

    var body: some View {
      if UIApplication.shared.supportsAlternateIcons {
        VStack(alignment: .leading, spacing: 12) {
          Text("App icon").font(.headline)
          Text("Choose the Index icon on this device.")
            .font(.caption).foregroundStyle(IndexPalette.mutedForeground)
          HStack(spacing: 16) {
            choice("Ink", name: nil, image: IndexBrand.inkIcon)
            choice("Paper", name: "AppIconPaper", image: IndexBrand.paperIcon)
          }.disabled(changing)
          if changing { ProgressView("Changing icon…").font(.caption) }
          if let errorMessage {
            Text(errorMessage).font(.caption).foregroundStyle(IndexPalette.destructive)
              .accessibilityLabel("Could not change app icon. \(errorMessage)")
          }
        }
        .onAppear { selectedName = UIApplication.shared.alternateIconName }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active { selectedName = UIApplication.shared.alternateIconName }
        }
      }
    }

    private func choice(_ title: String, name: String?, image: Image) -> some View {
      let selected = selectedName == name
      return Button {
        guard !changing, !selected else { return }
        changing = true
        errorMessage = nil
        Task { @MainActor in
          defer {
            selectedName = UIApplication.shared.alternateIconName
            changing = false
          }
          do { try await UIApplication.shared.setAlternateIconName(name) }
          catch { errorMessage = error.localizedDescription }
        }
      } label: {
        VStack(spacing: 8) {
          image.resizable().scaledToFit().frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(IndexPalette.border, lineWidth: 1))
          HStack(spacing: 4) {
            Text(title)
            Image(systemName: "checkmark.circle.fill").opacity(selected ? 1 : 0)
          }.font(.subheadline)
        }.padding(10)
          .background(selected ? IndexPalette.surface : Color.clear,
            in: RoundedRectangle(cornerRadius: 18))
      }.buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint("Changes the Home Screen app icon.")
    }
  #else
    var body: some View { EmptyView() }
  #endif
}
