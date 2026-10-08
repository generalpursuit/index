import Foundation

public enum Visibility: String, Codable, Sendable { case `public`, `private` }
public struct Person: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public var name: String
  public var username: String?
  public var bio: String?
  public var image: String?
  public var profileVisibility: Visibility
  public var label: String { username ?? name }
  public var initials: String {
    name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
  }
}
public struct SocialContext: Codable, Sendable {
  public let users: [Person]
  public let total: Int
}
public struct Profile: Codable, Sendable {
  public let id: String
  public var name: String
  public var username: String?
  public var bio: String?
  public var image: String?
  public var profileVisibility: Visibility
  public let canViewContent: Bool
  public let followerCount: Int?
  public let followingCount: Int?
  public let linkCount: Int?
  public let followedBy: SocialContext
  public let followingStatus: String?
  public var person: Person {
    Person(
      id: id, name: name, username: username, bio: bio, image: image,
      profileVisibility: profileVisibility)
  }
}
public enum Category: String, Codable, CaseIterable, Sendable {
  case uncategorized, article, podcast, music, video, book, tool, note
  public var symbol: String {
    switch self {
    case .uncategorized: "link"
    case .article: "doc.text"
    case .podcast: "headphones"
    case .music: "music.note"
    case .video: "video"
    case .book: "book"
    case .tool: "wrench"
    case .note: "note.text"
    }
  }
}
public struct SavedLink: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public let ownerId: String
  public let groupId: String?
  public let url: String
  public let title: String
  public let description: String?
  public let category: Category
  public var isFavorite: Bool
  public var isStarred: Bool
  public let savedOn: String
  public let createdAt: String
  public let updatedAt: String
  public var domain: String {
    (URL(string: url)?.host ?? url).replacingOccurrences(
      of: "^www\\.", with: "", options: .regularExpression)
  }
}
public struct LinkGroup: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public let ownerId: String
  public var name: String
  public let kind: String
  public var visibility: Visibility
}
public struct Page<Item: Codable & Sendable>: Codable, Sendable {
  public var items: [Item]
  public let nextCursor: String?
}
public struct PeoplePage: Codable, Sendable {
  public let items: [Person]
  public let nextAfter: String?
}
public struct Recommendations: Codable, Sendable { public let items: [Person] }
public struct PersonLinks: Codable, Sendable, Identifiable {
  public let author: Person
  public var links: Page<SavedLink>
  public var id: String { author.id }
}
public struct WeekFeed: Codable, Sendable {
  public let weekStart: String
  public let olderWeek: String?
  public let newerWeek: String?
  public var own: Page<SavedLink>
  public var people: [PersonLinks]
  public let nextAfter: String?
}
public struct LibraryWeek: Codable, Sendable, Identifiable {
  public let weekStart: String
  public let count: Int
  public var id: String { weekStart }
}
public struct LibraryWeeks: Codable, Sendable {
  public let items: [LibraryWeek]
  public let nextBefore: String?
}
public struct Comment: Codable, Identifiable, Sendable {
  public let id: String
  public let linkId: String
  public let authorId: String
  public let body: String
  public let createdAt: String
  public let author: Person?
}
public struct Activity: Codable, Identifiable, Sendable {
  public let id: String
  public let type: String
  public let actor: Person
  public let createdAt: String
  public let readAt: String?
  public let linkId: String?
  public let commentId: String?
  public let body: String?
  public let requestStatus: String?
}
public struct ActivityPage: Codable, Sendable {
  public let items: [Activity]
  public let nextCursor: String?
  public let unreadCount: Int
}
public struct Message: Codable, Identifiable, Sendable {
  public let id: String
  public let conversationId: String
  public let senderId: String
  public let clientId: String
  public let body: String
  public let createdAt: String
  public let attachment: SavedLink?
  public let hasAttachment: Bool
  public let restrictedAuthor: Person?
}
public struct Conversation: Codable, Identifiable, Sendable {
  public let id: String
  public let participants: [Person]
  public let canSend: Bool
  public let unreadCount: Int
  public let lastMessage: Message?
  public let updatedAt: String
  public func title(viewerId: String) -> String {
    let others = participants.filter { $0.id != viewerId }
    return others.map {
      others.count > 1 ? String($0.name.split(separator: " ").first ?? Substring($0.name)) : $0.name
    }.joined(separator: ", ")
  }
}
public struct Success: Codable, Sendable { public let success: Bool }
public struct UnreadCount: Codable, Sendable { public let unreadCount: Int }
public struct FollowState: Codable, Sendable { public let status: String }
public struct AuthUser: Codable, Sendable {
  public let id: String
  public let name: String
  public let email: String
}
public struct AuthSession: Codable, Sendable { public let user: AuthUser }

public enum Week {
  public static var calendar: Calendar {
    var calendar = Calendar(identifier: .iso8601)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    return calendar
  }
  public static func dateString(_ date: Date) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
  }
  public static func date(_ value: String) -> Date {
    let parts = value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3,
      let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    else { return Date() }
    return date
  }
  public static func monday(_ date: Date = Date()) -> String {
    dateString(calendar.dateInterval(of: .weekOfYear, for: date)!.start)
  }
  public static func shift(_ week: String, by count: Int) -> String {
    dateString(calendar.date(byAdding: .day, value: 7 * count, to: date(week))!)
  }
  public static func label(_ week: String) -> String {
    "Week \(calendar.component(.weekOfYear, from: date(week)))"
  }
}

extension Page {
  public static func joined(_ old: Self, _ next: Self) -> Self {
    Self(items: old.items + next.items, nextCursor: next.nextCursor)
  }
}
extension WeekFeed {
  public func appendingPeople(_ next: WeekFeed) -> WeekFeed {
    WeekFeed(
      weekStart: weekStart, olderWeek: olderWeek, newerWeek: newerWeek, own: own,
      people: people + next.people, nextAfter: next.nextAfter)
  }
}
