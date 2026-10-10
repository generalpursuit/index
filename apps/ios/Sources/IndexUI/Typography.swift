import CoreText
import SwiftUI

/// The same families and display optical size used by the web client. Register from the
/// package bundle so the app and share extensions do not depend on UIAppFonts in a host.
public enum IndexTypography {
  private static let registered: Void = {
    for name in ["IndexSans-Regular", "IndexSans-Medium", "IndexSans-Semibold", "IndexSerif-Semibold", "IndexSerif-Bold", "IndexMono-Regular"] {
      if let url = Bundle.module.url(forResource: name, withExtension: "ttf") {
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
      }
    }
  }()

  public static func sans(_ size: CGFloat = 13, weight: Font.Weight = .regular,
                          relativeTo style: Font.TextStyle = .body) -> Font {
    _ = registered
    let face = weight == .semibold || weight == .bold ? "Semibold" : weight == .medium ? "Medium" : "Regular"
    return .custom("IndexSans-" + face, size: size, relativeTo: style)
  }

  public static func serif(_ size: CGFloat, weight: Font.Weight = .bold, relativeTo style: Font.TextStyle = .title) -> Font {
    _ = registered
    return .custom(weight == .semibold ? "IndexSerif-Semibold" : "IndexSerif-Bold", size: size, relativeTo: style)
  }

  public static func mono(_ size: CGFloat = 12) -> Font {
    _ = registered
    return .custom("IndexMono-Regular", size: size, relativeTo: .caption)
  }
}

public struct IndexWordmark: View {
  public init() {}
  public var body: some View {
    Image("IndexWordmark", bundle: .module).resizable().scaledToFit().accessibilityLabel("Index")
  }
}

/// Template assets share the web's vector paths and inherit the current foreground color.
public struct IndexSymbol: View {
  let name: String
  public init(_ name: String) { self.name = name }
  public var body: some View {
    Image(name, bundle: .module).resizable().renderingMode(.template).scaledToFit()
  }
}
