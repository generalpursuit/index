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
