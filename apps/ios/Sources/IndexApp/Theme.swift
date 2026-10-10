import SwiftUI
import IndexCore
import IndexUI

typealias IndexPalette = IndexUI.IndexPalette

struct AppearanceSettings: View {
  @AppStorage(ThemePreference.storageKey) private var storedTheme = ThemePreference.system.rawValue
  private var selection: Binding<ThemePreference> {
    Binding(get: { ThemePreference(storedValue: storedTheme) }, set: { storedTheme = $0.rawValue })
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Appearance").font(.headline)
      Text("Choose how Index looks on this device.")
        .font(.caption).foregroundStyle(IndexPalette.mutedForeground)
      Picker("Appearance", selection: selection) {
        Text("System").tag(ThemePreference.system)
        Text("Light").tag(ThemePreference.light)
        Text("Dark").tag(ThemePreference.dark)
      }.pickerStyle(.segmented)
        .accessibilityHint("Saved on this device for all accounts. System follows your device appearance.")
    }
  }
}
