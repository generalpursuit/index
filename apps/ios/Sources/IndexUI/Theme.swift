import IndexCore
import SwiftUI
#if os(iOS)
  import UIKit
#else
  import AppKit
#endif

public extension ThemePreference {
  var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }
}

/// Mirrors packages/ui semantic roles; dynamic colors follow the view's chosen appearance.
public enum IndexPalette {
  public static let background = adaptive(light: 0xffffff, dark: 0x000000)
  public static let foreground = adaptive(light: 0x171717, dark: 0xf5f5f5)
  public static let surface = adaptive(light: 0xf5f5f5, dark: 0x141414)
  public static let card = adaptive(light: 0xffffff, dark: 0x111111)
  public static let muted = adaptive(light: 0xebebeb, dark: 0x222222)
  public static let mutedForeground = adaptive(light: 0x626262, dark: 0xa3a3a3)
  public static let subtleForeground = adaptive(light: 0x6b6b6b, dark: 0x929292)
  public static let input = adaptive(light: 0xb8b8b8, dark: 0x454545)
  public static let border = adaptive(light: 0xd4d4d4, dark: 0x303030)
  public static let primary = foreground
  public static let primaryForeground = background
  public static let destructive = adaptive(light: 0xb42332, dark: 0xff8a8a)
  // Initials sit on saturated avatar backgrounds in either scheme.
  public static let avatarForeground = Color.white

  public static func avatarBackground(for id: String) -> Color {
    // Web: hsl((sum of UTF-16 character codes * 37) % 360, 60%, 30%).
    let hue = Double((id.utf16.reduce(0) { $0 + Int($1) } * 37) % 360) / 360
    return Color(hue: hue, saturation: 0.75, brightness: 0.48)
  }

  public static func category(_ category: Category) -> Color {
    switch category {
    case .article: adaptive(light: 0x315cb5, dark: 0x7aa2ff)
    case .video: adaptive(light: 0xb23b3b, dark: 0xff7a7a)
    case .music: adaptive(light: 0x237744, dark: 0x5fd39a)
    case .podcast: adaptive(light: 0x7c4bbc, dark: 0xb794ff)
    case .book: adaptive(light: 0x966218, dark: 0xf0b45a)
    case .tool: adaptive(light: 0x237577, dark: 0x5ccfe6)
    case .note: adaptive(light: 0xa33679, dark: 0xff9ad5)
    case .uncategorized: adaptive(light: 0x737373, dark: 0x929292)
    }
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
