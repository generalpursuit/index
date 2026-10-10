import SwiftUI
import IndexCore
import IndexUI

typealias IndexPalette = IndexUI.IndexPalette
typealias IndexFont = IndexUI.IndexTypography
typealias IndexWordmark = IndexUI.IndexWordmark
typealias IndexSymbol = IndexUI.IndexSymbol

struct AppearanceSettings: View {
  @AppStorage(ThemePreference.storageKey) private var storedTheme = ThemePreference.system.rawValue
  private var selection: Binding<ThemePreference> {
    Binding(get: { ThemePreference(storedValue: storedTheme) }, set: { storedTheme = $0.rawValue })
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Appearance").font(IndexFont.sans(16, weight: .medium))
      Text("Choose how Index looks on this device.")
        .font(IndexFont.sans(12)).foregroundStyle(IndexPalette.mutedForeground)
      HStack(spacing: 8) {
        ForEach([ThemePreference.system, .light, .dark], id: \.rawValue) { theme in
          Button(theme.rawValue.capitalized) { selection.wrappedValue = theme }
            .buttonStyle(PillStyle(selected: selection.wrappedValue == theme))
            .accessibilityAddTraits(selection.wrappedValue == theme ? .isSelected : [])
        }
      }.padding(.top, 4)
        .accessibilityHint("Saved on this device for all accounts. System follows your device appearance.")
    }
  }
}
