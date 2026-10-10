import IndexCore
import SwiftUI
#if os(iOS)
  import UIKit
#else
  import AppKit
#endif

extension ThemePreference {
  var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }
}

/// Mirrors packages/ui semantic roles; dynamic colors follow the view's chosen appearance.
enum IndexPalette {
  static let background = adaptive(light: 0xffffff, dark: 0x000000)
  static let foreground = adaptive(light: 0x171717, dark: 0xf5f5f5)
  static let surface = adaptive(light: 0xf5f5f5, dark: 0x141414)
  static let card = adaptive(light: 0xffffff, dark: 0x111111)
  static let muted = adaptive(light: 0xebebeb, dark: 0x222222)
  static let mutedForeground = adaptive(light: 0x626262, dark: 0xa3a3a3)
  static let border = adaptive(light: 0xd4d4d4, dark: 0x303030)
  static let primary = foreground
  static let primaryForeground = background
  static let destructive = adaptive(light: 0xb42332, dark: 0xff8a8a)
  // Initials sit on saturated avatar backgrounds in either scheme.
  static let avatarForeground = Color.white

  static func avatarBackground(for id: String) -> Color {
    let colors: [UInt32] = [0x4338ca, 0x0f766e, 0x7e22ce, 0x9a3412, 0x9d174d, 0x166534]
    let hex = colors[id.utf8.reduce(0) { ($0 + Int($1)) % colors.count }]
    return adaptive(light: hex, dark: hex)
  }

  private static func adaptive(light: UInt32, dark: UInt32) -> Color {
    #if os(iOS)
      Color(uiColor: UIColor { traits in
        let hex = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
          red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
          blue: Double(hex & 255) / 255, alpha: 1)
      })
    #else
      Color(nsColor: NSColor(name: nil) { appearance in
        let hex = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        return NSColor(
          red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
          blue: Double(hex & 255) / 255, alpha: 1)
      })
    #endif
  }
}

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
