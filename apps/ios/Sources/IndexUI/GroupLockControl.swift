import SwiftUI
import IndexCore

public struct GroupLockControl: View {
  let locked: Bool
  var name = "group"
  var alwaysPrivate = false
  var disabled = false
  let onChange: (Bool) -> Void
  public init(locked: Bool, name: String = "group", alwaysPrivate: Bool = false, disabled: Bool = false, onChange: @escaping (Bool) -> Void) {
    self.locked = locked; self.name = name; self.alwaysPrivate = alwaysPrivate; self.disabled = disabled; self.onChange = onChange
  }
  public var body: some View {
    Button { onChange(!locked) } label: {
      Image(systemName: locked || alwaysPrivate ? "lock" : "lock.open")
        .frame(width: 44, height: 44).contentShape(Rectangle())
    }
    .buttonStyle(.plain).foregroundStyle(IndexPalette.foreground)
    .disabled(disabled || alwaysPrivate)
    .accessibilityLabel(alwaysPrivate ? "\(name): Always private" : "Lock \(name)")
    .accessibilityValue(locked || alwaysPrivate ? "Locked" : "Unlocked")
    .accessibilityHint(alwaysPrivate ? "Starred is always private." : GroupDraft.privacyDescription(locked: locked))
  }
}
