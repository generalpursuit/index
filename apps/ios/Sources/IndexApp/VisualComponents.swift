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
  func indexSheetStyle() -> some View {
    modifier(IndexSheetStyle())
  }
  func settingsBox() -> some View {
    self.padding(20).frame(maxWidth: .infinity, alignment: .leading)
      .overlay(RoundedRectangle(cornerRadius: 18).stroke(IndexPalette.border, lineWidth: 1))
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
  @State private var presentationID = UUID()
  func body(content: Content) -> some View {
    content.environment(\.indexSheet, true)
      .font(IndexFont.sans()).foregroundStyle(IndexPalette.foreground)
      .presentationBackground(IndexPalette.surface).presentationCornerRadius(22)
      .presentationDragIndicator(.visible)
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
  var body: some View {
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

struct CategoryMark: View {
  let category: IndexCore.Category
  var body: some View {
    RoundedRectangle(cornerRadius: 2).fill(IndexPalette.category(category))
      .frame(width: 8, height: 8).accessibilityHidden(true)
  }
}

/// CSS's minmax(0, 1fr) / auto columns: a short domain only takes its actual width;
/// a long domain is capped at 120 points and the title receives the remaining space.
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
      view.place(at: CGPoint(x: index == 0 ? bounds.minX : bounds.maxX - trailing, y: bounds.minY),
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
      } else { ProgressView().controlSize(.small).padding(8) }
    }.frame(maxWidth: .infinity).task { await load() }
  }
  private func load() async {
    guard !loading, !failed else { return }
    loading = true
    defer { loading = false }
    do { try await action() } catch is CancellationError {} catch { failed = true }
  }
}

struct SearchField: View {
  let placeholder: String
  @Binding var text: String
  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "magnifyingglass").font(.system(size: 18)).foregroundStyle(IndexPalette.subtleForeground)
      TextField(placeholder, text: $text).textFieldStyle(.plain).font(IndexFont.sans(16))
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
        #endif
      if !text.isEmpty {
        Button { text = "" } label: { Image(systemName: "xmark").frame(width: 28, height: 28) }
          .buttonStyle(.plain).accessibilityLabel("Clear search")
      }
    }.padding(.horizontal, 14).frame(minHeight: 44)
      .overlay(RoundedRectangle(cornerRadius: 10).stroke(IndexPalette.border, lineWidth: 1))
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

struct WeekScrubber: View {
  let weeks: [String]
  let selected: String
  let onSelect: (String) -> Void
  @State private var hovered: Int?
  var body: some View {
    if weeks.count > 1 {
      GeometryReader { geometry in
        VStack(alignment: .leading, spacing: 0) {
          ForEach(weeks, id: \.self) { week in
            Rectangle().fill(week == selected ? IndexPalette.foreground : IndexPalette.input)
              .frame(width: week == selected ? 22 : 10, height: 2)
              .frame(maxHeight: .infinity)
          }
        }.frame(width: 28, height: geometry.size.height, alignment: .leading)
          .contentShape(Rectangle())
          .gesture(DragGesture(minimumDistance: 0).onChanged { value in
            hovered = index(at: value.location.y, height: geometry.size.height)
          }.onEnded { value in
            onSelect(weeks[index(at: value.location.y, height: geometry.size.height)])
            hovered = nil
          })
          .overlay(alignment: .topTrailing) {
            if let hovered, weeks.indices.contains(hovered) {
              VStack(alignment: .leading, spacing: 3) {
                Text(Week.label(weeks[hovered])).font(IndexFont.serif(16))
                Text(weekRange(weeks[hovered])).font(IndexFont.sans(11))
              }.fixedSize().padding(10).background(IndexPalette.card, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(IndexPalette.border))
                .offset(x: -36, y: max(0, min(geometry.size.height - 52,
                  (CGFloat(hovered) + 0.5) / CGFloat(weeks.count) * geometry.size.height - 26)))
            }
          }
      }.frame(width: 28).frame(maxHeight: CGFloat(weeks.count) * 12)
        .accessibilityHidden(true) // The heading opens the same choices as accessible buttons.
    }
  }
  private func index(at y: CGFloat, height: CGFloat) -> Int {
    min(weeks.count - 1, max(0, Int(y / max(1, height) * CGFloat(weeks.count))))
  }
}
