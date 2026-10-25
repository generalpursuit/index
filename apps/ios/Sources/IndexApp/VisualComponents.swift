import IndexCore
import IndexFeatures
import SwiftUI

private struct IndexSheetKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
  var indexSheet: Bool {
    get { self[IndexSheetKey.self] }
    set { self[IndexSheetKey.self] = newValue }
  }
}

struct IndexPageStyle: ViewModifier {
  @Environment(\.indexSheet) private var isSheet
  func body(content: Content) -> some View {
    content.padding(.horizontal, 20).padding(.top, isSheet ? 20 : 40)
      .background(isSheet ? IndexPalette.surface : IndexPalette.background)
  }
}

extension View {
  /// The app root's styles. Sheets don't inherit them, so each sheet applies them again.
  func indexAppStyle() -> some View {
    self.scrollIndicators(.hidden)
      .tint(IndexPalette.foreground).toggleStyle(IndexSwitchStyle())
      .font(IndexFont.sans()).foregroundStyle(IndexPalette.foreground)
  }
  func indexSheetStyle() -> some View {
    modifier(IndexSheetStyle())
  }
  func hideNativeNavigation() -> some View {
    #if os(iOS)
      self.toolbar(.hidden, for: .navigationBar)
    #else
      self
    #endif
  }
  func bottomFade() -> some View {
    self.mask {
      VStack(spacing: 0) {
        Rectangle()
        LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: 24)
      }
    }
  }
}

private struct IndexSheetStyle: ViewModifier {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var presentationID = UUID()
  func body(content: Content) -> some View {
    content.environment(\.indexSheet, true).indexAppStyle()
      .presentationBackground(IndexPalette.surface).presentationCornerRadius(22)
      .presentationDragIndicator(.visible)
      .accessibilityAction(.escape) { dismiss() }
      .onAppear {
        if !app.sheetPresentations.contains(presentationID) { app.sheetPresentations.append(presentationID) }
      }
      .onDisappear { app.sheetPresentations.removeAll { $0 == presentationID } }
      .modifier(AppErrorPresentation(presentationID: presentationID))
  }
}

struct AppErrorPresentation: ViewModifier {
  var presentationID: UUID? = nil
  @Environment(AppModel.self) private var app
  func body(content: Content) -> some View {
    content.alert("Couldn’t complete that", isPresented: Binding(
      get: { app.error != nil && app.sheetPresentations.last == presentationID },
      set: { if !$0 && app.sheetPresentations.last == presentationID { app.error = nil } }
    )) {
      Button("OK") { app.error = nil }
    } message: { Text(app.error ?? "") }
  }
}

struct BackButton: View {
  @Environment(AppModel.self) private var app
  var body: some View {
    Button { if !app.navigation.path.isEmpty { app.navigation.path.removeLast() } } label: {
      Image(systemName: "chevron.left").font(.system(size: 20, weight: .regular))
        .frame(width: 44, height: 44)
    }.buttonStyle(.plain).accessibilityLabel("Back")
  }
}
struct SheetCloseButton: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.indexSheet) private var isSheet
  var body: some View {
    #if os(iOS)
      if !isSheet { closeButton }
    #else
      closeButton
    #endif
  }
  private var closeButton: some View {
    Button { dismiss() } label: {
      Image(systemName: "xmark").font(.system(size: 18, weight: .regular))
        .frame(width: 44, height: 44)
    }.buttonStyle(.plain).accessibilityLabel("Close")
  }
}

/// Uses the same vector assets and stroke width as the mobile web navigation.
struct NavigationIcon: View {
  let tab: AppTab
  var body: some View {
    IndexSymbol("Nav" + tab.rawValue.capitalized)
      .frame(width: tab == .feed ? 16.5 : 25, height: 25).accessibilityHidden(true)
  }
}

/// CSS's minmax(0, 1fr) / auto columns: a short domain only takes its actual width;
/// a long domain is capped at 120 points and the title receives the remaining space.
/// Columns share a vertical center even when a text field and menu have different heights.
struct LinkRowLayout: Layout {
  private let gap: CGFloat = 12
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 320
    let trailing = trailingWidth(width, subviews)
    let leading = max(0, width - trailing - (subviews.count > 1 ? gap : 0))
    let heights = subviews.enumerated().map { index, view in
      view.sizeThatFits(ProposedViewSize(width: index == 0 ? leading : trailing, height: nil)).height
    }
    return CGSize(width: width, height: heights.max() ?? 0)
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let trailing = trailingWidth(bounds.width, subviews)
    let leading = max(0, bounds.width - trailing - (subviews.count > 1 ? gap : 0))
    for (index, view) in subviews.enumerated() {
      view.place(at: CGPoint(x: index == 0 ? bounds.minX : bounds.maxX - trailing, y: bounds.midY), anchor: .leading,
        proposal: ProposedViewSize(width: index == 0 ? leading : trailing, height: bounds.height))
    }
  }
  private func trailingWidth(_ width: CGFloat, _ subviews: Subviews) -> CGFloat {
    guard subviews.count > 1 else { return 0 }
    return min(120, width * 0.4, subviews[1].sizeThatFits(.unspecified).width)
  }
}

/// A lazy-list sentinel keeps pagination out of the visual layout and still offers retry.
struct PageEnd: View {
  let cursor: String?
  let action: () async throws -> Void
  var body: some View {
    if let cursor { PageLoadTrigger(action: action).id(cursor) }
  }
}
private struct PageLoadTrigger: View {
  let action: () async throws -> Void
  @State private var loading = false
  @State private var failed = false
  var body: some View {
    Group {
      if failed {
        Button("Load more") { failed = false; Task { await load() } }.buttonStyle(PillStyle())
      } else { Color.clear.frame(height: 32) }
    }.frame(maxWidth: .infinity).task { await load() }
  }
  private func load() async {
    guard !loading, !failed else { return }
    loading = true
    defer { loading = false }
    do { try await action(); failed = true } catch is CancellationError {} catch { failed = true }
  }
}

func weekRange(_ week: String) -> String {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_GB")
  formatter.timeZone = Week.calendar.timeZone
  let start = Week.date(week)
  let end = Week.calendar.date(byAdding: .day, value: 6, to: start)!
  let sameYear = Week.calendar.component(.year, from: start) == Week.calendar.component(.year, from: end)
  let currentYear = Week.calendar.component(.year, from: Date())
  let showYear = !sameYear || Week.calendar.component(.year, from: start) != currentYear
  formatter.dateFormat = showYear ? "d MMM yyyy" : "d MMM"
  let endLabel = formatter.string(from: end)
  if sameYear && Week.calendar.component(.month, from: start) == Week.calendar.component(.month, from: end) {
    formatter.dateFormat = "d"
  }
  return formatter.string(from: start) + " – " + endLabel
}

struct ProfileWeekPositions: PreferenceKey {
  static let defaultValue: [String: CGFloat] = [:]
  static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
    value.merge(nextValue(), uniquingKeysWith: { _, new in new })
  }
}

/// Profile metadata wraps like the web's flex-wrap line instead of squeezing tiny counts.
struct ProfileMetaLayout: Layout {
  var spacing: CGFloat = 4
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    layout(width: proposal.width ?? 320, subviews: subviews).size
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let result = layout(width: bounds.width, subviews: subviews)
    for (index, point) in result.points.enumerated() {
      subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y),
                           proposal: ProposedViewSize(width: bounds.width, height: nil))
    }
  }
  private func layout(width: CGFloat, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
    var points: [CGPoint] = []
    for view in subviews {
      let size = view.sizeThatFits(ProposedViewSize(width: width, height: nil))
      if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      points.append(CGPoint(x: x, y: y))
      x += size.width + spacing; rowHeight = max(rowHeight, size.height)
    }
    return (CGSize(width: width, height: y + rowHeight), points)
  }
}

struct WeekPicker: View {
  let weeks: [String]
  let selected: String
  let onSelect: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          PageHeading(title: "Jump to a week").padding(.bottom, 20)
          ForEach(weeks, id: \.self) { week in
            Button {
              onSelect(week); dismiss()
            } label: {
              HStack {
                Text(Week.label(week)).font(IndexFont.serif(24))
                Text(weekRange(week)).font(IndexFont.mono(11)).foregroundStyle(IndexPalette.subtleForeground)
                Spacer()
                if week == selected { Image(systemName: "checkmark") }
              }.padding(.vertical, 16).contentShape(Rectangle())
            }.buttonStyle(.plain).id(week)
              .accessibilityAddTraits(week == selected ? .isSelected : [])
          }
        }.padding(20)
      }.onAppear { proxy.scrollTo(selected, anchor: .center) }
    }.indexSheetStyle().presentationDetents([.medium, .large])
  }
}
