import Foundation
import IndexCore

/// One message placed in its conversation as iMessage shows it. Consecutive messages from
/// one sender form a run; a date stamp opens the thread and follows any pause of an hour.
public struct MessageTimelineRow: Identifiable, Sendable {
  public let message: Message
  /// The time a stamp before this message shows, when it opens a section.
  public let stamp: Date?
  /// Whether this message opens its sender's run.
  public let startsRun: Bool
  /// Whether this message closes its sender's run, so its bubble takes the run's tail.
  public let endsRun: Bool
  public var id: String { message.id }
}

/// A stamp's emphasised day and its time, such as "Today" and "11:15".
public struct MessageStamp: Equatable, Sendable {
  public let day: String
  public let time: String
  public var text: String { day + " " + time }
}

public enum MessageTimeline {
  private static let pause: TimeInterval = 60 * 60

  /// Places oldest-first messages into stamped sections of sender runs.
  public static func rows(_ messages: [Message]) -> [MessageTimelineRow] {
    let dates = messages.map { APITimestamp.date($0.createdAt) }
    let opensSection = messages.indices.map { index in
      guard index > 0, let previous = dates[index - 1], let date = dates[index] else { return index == 0 }
      return date.timeIntervalSince(previous) >= pause
    }
    return messages.indices.map { index in
      let message = messages[index]
      let last = index == messages.count - 1
      return MessageTimelineRow(
        message: message,
        stamp: opensSection[index] ? dates[index] : nil,
        startsRun: opensSection[index] || messages[index - 1].senderId != message.senderId,
        endsRun: last || opensSection[index + 1] || messages[index + 1].senderId != message.senderId)
    }
  }

  /// A stamp in the viewer's calendar and locale: "Today 11:15", "Yesterday 09:02",
  /// "Thursday 23:40" within the last week, otherwise "Sun 4 Oct at 14:19".
  public static func stamp(
    _ date: Date, now: Date = .now, calendar: Calendar = .autoupdatingCurrent,
    locale: Locale = .autoupdatingCurrent
  ) -> MessageStamp {
    let style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
    let time = date.formatted(style.hour().minute())
    // Whole calendar days, so daylight-saving days count once. A clock slightly ahead of
    // this device still reads as today.
    let days =
      calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day
      ?? 0
    if days <= 0 { return MessageStamp(day: "Today", time: time) }
    if days == 1 { return MessageStamp(day: "Yesterday", time: time) }
    if days < 7 { return MessageStamp(day: date.formatted(style.weekday(.wide)), time: time) }
    let day =
      calendar.isDate(date, equalTo: now, toGranularity: .year)
      ? style.weekday(.abbreviated).day().month(.abbreviated) : style.day().month(.abbreviated).year()
    return MessageStamp(day: date.formatted(day), time: "at " + time)
  }
}
