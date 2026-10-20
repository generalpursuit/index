import IndexCore
import IndexUI
import SwiftUI

/// A strip along the trailing edge with one tick per week, read like a ruler: length shows the
/// unit and ink the state. Weeks are short and light, the selected week dark at a middle length,
/// and the first week of a year long. Pressing goes to the week under the finger, and dragging
/// scrubs through the weeks while the ticks near the finger surface. Holding still opens a focus
/// ring that spreads out the nearby weeks, so a drag then moves one week at a time. The heading
/// opens the same choice as accessible buttons (`WeekPicker`), so VoiceOver skips this.
struct WeekScrubber: View {
  let weeks: [String]
  let selected: String
  let onSelect: (String) -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// The week under the finger, which the label names.
  @State private var named: Int?
  /// Whether the label's number last moved to an older week, so it rolls that way.
  @State private var older = false
  /// The finger's position in ticks, 0 at the first tick's middle.
  @State private var finger: CGFloat?
  @State private var hold: Task<Void, Never>?
  @State private var focus: Focus?
  /// Derived from `weeks` once rather than on every frame of a drag.
  @State private var years: [String?] = []
  @State private var ranges: [String] = []

  /// The open focus ring: where it was held, and the (fractional mid-drag) week at its center.
  private struct Focus {
    let y: CGFloat
    let index: Int
    var at: CGFloat
  }
  // Holding still this long opens the focus ring; moving farther than `dragSlop` first makes a
  // drag. In the ring each week is a `row` tall, and the finger moves one row per week.
  private static let holdDelay = Duration.milliseconds(350)
  private static let dragSlop: CGFloat = 6
  private static let row: CGFloat = 24
  private static let ringSize = CGSize(width: 52, height: 264)
  // Ticks within `surface` points of the finger grow.
  private static let surface: CGFloat = 44

  var body: some View {
    if weeks.count > 1 {
      GeometryReader { geometry in
        let height = geometry.size.height
        ticks(pitch: height / CGFloat(weeks.count))
          .frame(width: 28, height: height)
          .contentShape(Rectangle())
          .gesture(DragGesture(minimumDistance: 0)
            .onChanged { drag($0, height: height) }
            .onEnded { _ in release() })
          .overlay(alignment: .topTrailing) {
            if let focus {
              ring(focus).offset(y: focus.y - Self.ringSize.height / 2).allowsHitTesting(false)
                .transition(.scale(scale: 0.6, anchor: .trailing).combined(with: .opacity))
            }
          }
          .overlay(alignment: .topTrailing) {
            if let named, weeks.indices.contains(named) {
              let center = focus?.y ?? (CGFloat(named) + 0.5) / CGFloat(weeks.count) * height
              label(weeks[named])
                .offset(x: focus == nil ? -36 : -60, y: max(0, min(height - 52, center - 26)))
                .animation(reduceMotion ? nil : .easeOut(duration: 0.09), value: named)
                .allowsHitTesting(false)
            }
          }
      }.frame(width: 28).frame(maxHeight: CGFloat(weeks.count) * 12)
        .onAppear(perform: prepare)
        .onChange(of: weeks) { prepare() }
        .sensoryFeedback(trigger: named) { _, index in
          guard let index else { return nil }
          return year(index) == nil ? .selection : .impact(weight: .light)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: focus != nil) { _, open in open }
        .accessibilityHidden(true)
    }
  }

  private func ticks(pitch: CGFloat) -> some View {
    let reach = max(2.5, Self.surface / pitch)
    return Canvas { context, size in
      for index in weeks.indices {
        let isSelected = weeks[index] == selected, startsYear = year(index) != nil
        // A selected week that starts a year keeps the year's length.
        let length: CGFloat = startsYear ? 24 : isSelected ? 16 : 8
        var width = length, opacity: CGFloat = isSelected ? 1 : startsYear ? 0.5 : 0.32
        if let finger {
          // Nearness darkens ticks and grows plain weeks up to the middle length.
          let near = max(0, 1 - abs(CGFloat(index) - finger) / reach)
          width = min(max(length, 16), length + 8 * near * near)
          opacity += (1 - opacity) * near * near
        }
        if index == named { opacity = 1 }
        // Under the open ring, ticks give way to its rows.
        if let focus, abs((CGFloat(index) + 0.5) * pitch - focus.y) < Self.ringSize.height / 2 {
          continue
        }
        let thickness: CGFloat = isSelected ? 3 : 2
        let rect = CGRect(x: (size.width - width) / 2, y: (CGFloat(index) + 0.5) * pitch - thickness / 2,
          width: width, height: thickness)
        context.fill(Capsule().path(in: rect), with: .color(IndexPalette.foreground.opacity(opacity)))
      }
    }
  }

  /// The named week, at a fixed size: every label this list can show sits unseen beneath it.
  private func label(_ week: String) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      ZStack(alignment: .leading) {
        Text("Week 53").hidden()
        Text(Week.label(week)).contentTransition(.numericText(countsDown: older))
      }.font(IndexFont.serif(16))
      ZStack(alignment: .leading) {
        ForEach(ranges, id: \.self) { Text($0).hidden() }
        Text(weekRange(week))
      }.font(IndexFont.sans(11)).foregroundStyle(IndexPalette.subtleForeground)
    }.fixedSize().padding(10).background(IndexPalette.card, in: RoundedRectangle(cornerRadius: 12))
      .overlay(RoundedRectangle(cornerRadius: 12).stroke(IndexPalette.border))
  }

  /// The weeks around the held one, a row each, sliding past the selection marks as the finger
  /// moves. A row that starts a year shows the year in place of its number, unless selected.
  private func ring(_ focus: Focus) -> some View {
    let center = Int(focus.at.rounded())
    let rows = max(0, center - 6)...min(weeks.count - 1, center + 6)
    let tick = Capsule().fill(IndexPalette.foreground).frame(width: 8, height: 3)
    return ZStack {
      IndexPalette.background
      ForEach(rows, id: \.self) { index in
        Group {
          if index != center, let year = year(index) {
            Text(year).font(IndexFont.mono(11)).foregroundStyle(IndexPalette.subtleForeground)
          } else {
            Text(String(Week.number(weeks[index]))).font(IndexFont.mono(13))
              .fontWeight(index == center ? .bold : .regular)
          }
        }
        .offset(y: (CGFloat(index) - focus.at) * Self.row)
        .opacity(max(0, 1 - abs(CGFloat(index) - focus.at) / 5.5))
      }
      HStack { tick; Spacer(); tick }
    }
    .frame(width: Self.ringSize.width, height: Self.ringSize.height)
    .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.3),
      .init(color: .black, location: 0.7), .init(color: .clear, location: 1)],
      startPoint: .top, endPoint: .bottom))
  }

  private func drag(_ value: DragGesture.Value, height: CGFloat) {
    if let focus {
      let at = min(CGFloat(weeks.count - 1),
        max(0, CGFloat(focus.index) + (value.location.y - focus.y) / Self.row))
      self.focus?.at = at
      name(Int(at.rounded()))
      return
    }
    let position = value.location.y / max(1, height) * CGFloat(weeks.count)
    finger = position - 0.5
    name(min(weeks.count - 1, max(0, Int(position))))
    if hold == nil {
      let y = value.startLocation.y
      hold = Task {
        try? await Task.sleep(for: Self.holdDelay)
        guard !Task.isCancelled, let named else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) {
          focus = Focus(y: y, index: named, at: CGFloat(named))
        }
      }
    } else if abs(value.translation.height) > Self.dragSlop {
      hold?.cancel()
    }
  }

  /// Names the week under the finger and goes there.
  private func name(_ index: Int) {
    guard index != named else { return }
    if let named { older = index > named }
    named = index
    onSelect(weeks[index])
  }

  private func release() {
    hold?.cancel()
    hold = nil
    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.12)) { focus = nil }
    named = nil
    finger = nil
  }

  private func prepare() {
    years = Week.yearMarks(weeks)
    ranges = Set(weeks.map(weekRange)).sorted()
  }

  /// Until `prepare` catches up with new weeks, no week starts a year.
  private func year(_ index: Int) -> String? {
    years.count == weeks.count ? years[index] : nil
  }
}
