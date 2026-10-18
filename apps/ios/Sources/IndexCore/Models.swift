import Foundation

public enum Visibility: String, Codable, Sendable { case `public`, `private` }
public struct Person: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public var name: String
  public var username: String?
  public var image: String?
  public var profileVisibility: Visibility
  public var followingStatus: String? = nil
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
  public var image: String?
  public var profileVisibility: Visibility
  public var canViewContent: Bool
  public var followerCount: Int?
  public var followingCount: Int?
  public var linkCount: Int?
  public let followedBy: SocialContext
  public var followingStatus: String?
  public var person: Person {
    Person(
      id: id, name: name, username: username, image: image,
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
  public let shortId: String?
  public let ownerId: String
  public var groupId: String?
  public var url: String
  public var title: String
  public var description: String?
  public var category: Category
  public var isFavorite: Bool
  public var isStarred: Bool
  public let savedOn: String
  public let createdAt: String
  public var updatedAt: String
  public var domain: String {
    (URL(string: url)?.host ?? url).replacingOccurrences(
      of: "^www\\.", with: "", options: .regularExpression)
  }
}
public struct LinkGroup: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public let slug: String?
  public let ownerId: String
  public var name: String
  public let kind: String
  public var visibility: Visibility
  public var linkCount: Int? = nil
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
  public var author: Person
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
  public var readAt: String?
  public let linkId: String?
  public let commentId: String?
  public let body: String?
  public var requestStatus: String?
}
public struct ActivityPage: Codable, Sendable {
  public let items: [Activity]
  public let nextCursor: String?
  public var unreadCount: Int
}
/// The server's limits on what one message may carry, and which of its files show as photos.
public enum MessageLimits {
  public static let files = 10
  /// Counted as Finder and iOS show sizes, where a megabyte is a million bytes.
  public static let fileBytes = 25_000_000
  /// The image types the server serves as images. It serves anything else, HEIC too, as opaque
  /// bytes, so only these show inline.
  /// Mirrors `inlineImageTypes` in `packages/api/src/features/messages/files.ts`.
  public static let photoTypes: Set<String> = ["image/jpeg", "image/png", "image/gif", "image/webp"]
}

/// A file sent in a conversation. Photos keep their image type; anything else arrives as
/// opaque bytes and opens in Quick Look.
public struct MessageFile: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public let name: String
  public let type: String
  public let size: Int
  public let width: Int?
  public let height: Int?
  public init(id: String, name: String, type: String, size: Int, width: Int?, height: Int?) {
    self.id = id; self.name = name; self.type = type; self.size = size; self.width = width; self.height = height
  }
  public var isPhoto: Bool { MessageLimits.photoTypes.contains(type) }
  /// Kind and size, as in "PDF · 240 KB".
  public var details: String {
    let kind = (name as NSString).pathExtension.uppercased()
    let amount = ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    return kind.isEmpty ? amount : "\(kind) · \(amount)"
  }
}

extension Array where Element == MessageFile {
  /// What files a message without text carries: "Photo", "3 photos", a file's name or "2 files".
  public var summary: String? {
    guard let first else { return nil }
    let photos = allSatisfy(\.isPhoto)
    if count == 1 { return photos ? "Photo" : first.name }
    return "\(count) \(photos ? "photos" : "files")"
  }
}

/// The start of a replied message, with its files. A shared post stays behind its own
/// visibility rules, so a reply only learns that there was one.
public struct MessageReply: Codable, Hashable, Sendable {
  public let id: String
  public let senderId: String
  public let excerpt: String
  public let hasAttachment: Bool
  public let files: [MessageFile]
  /// How a draft quotes `message` until the server returns the sent reply's own excerpt.
  public init(quoting message: Message) {
    id = message.id
    senderId = message.senderId
    excerpt = message.body
    hasAttachment = message.hasAttachment
    files = message.files
  }
  /// The quoted text. A replied message without text carried files or a shared post.
  public var preview: String { excerpt.isEmpty ? (files.summary ?? (hasAttachment ? "Shared post" : "")) : excerpt }
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
  public let files: [MessageFile]
  public let restrictedAuthor: Person?
  /// Null once the replied message is deleted.
  public let replyTo: MessageReply?
}
public struct Conversation: Codable, Identifiable, Sendable {
  public let id: String
  public let shortId: String?
  public let participants: [Person]
  public let canSend: Bool
  public var unreadCount: Int
  /// The viewer's newest message that every other member has read.
  public let readReceiptMessageId: String?
  public var lastMessage: Message?
  public var updatedAt: String
  public func title(viewerId: String) -> String {
    let others = participants.filter { $0.id != viewerId }
    return others.map {
      others.count > 1 ? String($0.name.split(separator: " ").first ?? Substring($0.name)) : $0.name
    }.joined(separator: ", ")
  }
  /// Who a reply answers, from the point of view of the person reading it.
  public func replyLabel(viewerId: String, from sender: String, to original: String) -> String {
    if original != viewerId {
      return "Replying to " + (participants.first { $0.id == original }?.name ?? "a former participant")
    }
    return sender == viewerId ? "Replying to yourself" : "Replying to you"
  }
}
/// API timestamps are ISO 8601, with or without fractional seconds.
public enum APITimestamp {
  public static func date(_ value: String) -> Date? {
    (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value))
      ?? (try? Date.ISO8601FormatStyle().parse(value))
  }
}
public struct Success: Codable, Sendable { public let success: Bool }
public struct UnreadCount: Codable, Sendable { public var unreadCount: Int }
public struct FollowState: Codable, Sendable { public let status: String }
public struct AuthUser: Codable, Sendable {
  public let id: String
  public let name: String
  public let email: String
  public let emailVerified: Bool
}
public struct AuthChallengeStatus: Codable, Sendable {
  public let email: String
  public let pending: Bool
  public let delivery: String
  public let retryAfter: Int
  public let expiresAt: String?
}
public struct AccountSecurityStatus: Codable, Sendable {
  public let verification: AuthChallengeStatus
  public let emailChange: AuthChallengeStatus
}
public struct CodeRequestResult: Codable, Sendable {
  public let success: Bool
  public let retryAfter: Int
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

public struct Pulse: Codable, Sendable {
  public struct ListState: Codable, Sendable {
    public let unreadCount: Int
    public let version: String
  }
  public let messages: ListState
  public let activity: ListState
}

extension Message {
  public static func pending(clientID: String, conversationID: String, senderID: String, body: String, attachment: SavedLink?, files: [MessageFile], reply: MessageReply?) -> Message {
    Message(id: clientID, conversationId: conversationID, senderId: senderID, clientId: clientID, body: body,
      createdAt: Date().formatted(.iso8601), attachment: attachment, hasAttachment: attachment != nil, files: files, restrictedAuthor: nil, replyTo: reply)
  }
}
extension Comment {
  public static func pending(linkID: String, author: Person, body: String) -> Comment {
    Comment(id: UUID().uuidString, linkId: linkID, authorId: author.id, body: body, createdAt: Date().formatted(.iso8601), author: author)
  }
}

extension Profile {
  public static func summary(_ person: Person) -> Profile {
    Profile(id: person.id, name: person.name, username: person.username, image: person.image,
      profileVisibility: person.profileVisibility, canViewContent: false, followerCount: nil, followingCount: nil,
      linkCount: nil, followedBy: SocialContext(users: [], total: 0), followingStatus: person.followingStatus)
  }
}

extension Person {
  public static func clearedAccount(_ id: String) -> Person { Person(id: id, name: "", profileVisibility: .public) }
  public static func accountIdentity(_ user: AuthUser) -> Person {
    Person(id: user.id, name: user.name, profileVisibility: .public)
  }
}

/// Placeholder values only enter disabled, redacted presentation; they are never stored
/// or navigated. The same domain values let the real layouts own their loading geometry.
public enum ContentPlaceholder {
  public static func person(_ index: Int = 0) -> Person {
    Person(id: "placeholder-\(index)", name: "A familiar person", username: "someone", profileVisibility: .public)
  }
  public static func link(_ index: Int = 0) -> SavedLink {
    SavedLink(id: "placeholder-\(index)", shortId: nil, ownerId: "placeholder", groupId: nil,
      url: "https://example.com", title: "Something worth coming back to", description: "A few thoughts to remember.",
      category: .article, isFavorite: false, isStarred: false, savedOn: Week.monday(),
      createdAt: Date().formatted(.iso8601), updatedAt: Date().formatted(.iso8601))
  }
  public static var profile: Profile {
    var value = Profile.summary(person())
    value.canViewContent = true
    return value
  }
  public static func feed(_ week: String) -> WeekFeed {
    WeekFeed(weekStart: week, olderWeek: nil, newerWeek: nil,
      own: Page(items: (0..<5).map(link), nextCursor: nil),
      people: [PersonLinks(author: person(), links: Page(items: (0..<5).map(link), nextCursor: nil))], nextAfter: nil)
  }
  public static func conversation(_ index: Int = 0) -> Conversation {
    Conversation(id: "placeholder-\(index)", shortId: nil, participants: [person(index)], canSend: false,
      unreadCount: 0, readReceiptMessageId: nil, lastMessage: message(index), updatedAt: Date().formatted(.iso8601))
  }
  public static func message(_ index: Int = 0) -> Message {
    Message(id: "placeholder-\(index)", conversationId: "placeholder", senderId: "placeholder-0", clientId: "placeholder-\(index)",
      body: "A good find to share with you", createdAt: Date().formatted(.iso8601),
      attachment: nil, hasAttachment: false, files: [], restrictedAuthor: nil, replyTo: nil)
  }
  public static var notificationPreferences: NotificationPreferences {
    NotificationPreferences(message: false, comment: false, mention: false, request: false, follow: false, accepted: false, previews: false)
  }
  public static func group(_ index: Int = 0) -> LinkGroup {
    LinkGroup(id: "placeholder-\(index)", slug: nil, ownerId: "placeholder", name: "A collection of links", kind: "custom", visibility: .public)
  }
  public static func activity(_ index: Int = 0) -> Activity {
    Activity(id: "placeholder-\(index)", type: "follow", actor: person(index), createdAt: Date().formatted(.iso8601),
      readAt: nil, linkId: nil, commentId: nil, body: nil, requestStatus: nil)
  }
}
