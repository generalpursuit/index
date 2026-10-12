import Foundation
import IndexCore
import Observation

public enum Destination: Hashable, Identifiable {
  case profile(String), collection(String, String), link(String), messages, conversation(String)
  case connections(String), add(String, String?, SavedLink?), recipients(SavedLink?), settings, group(LinkGroup?)
  public var id: Self { self }
}
public enum AppTab: String, CaseIterable {
  case feed, discover, activity, messages, profile
  public var title: String { self == .feed ? "Home" : self == .profile ? "Your profile" : rawValue.capitalized }
}

@MainActor @Observable
public final class AppNavigation {
  public var path: [Destination] = []
  public var sheet: Destination?
  public var tab = AppTab.feed
  public var openingLink: SavedLink?
  public var openingConversation: Conversation?
  public var pendingRouteURL: URL?
  public var pendingRouteAccountID: String?
  public var routeTask: Task<Void, Never>?
  public init() {}
  public func openLink(_ link: SavedLink) { openingLink = link; present(.link(link.id)) }
  public func present(_ destination: Destination) { sheet = destination }
  public func navigate(_ destination: Destination) { sheet = nil; path.append(destination) }
  public var showsTabs: Bool {
    guard let destination = path.last else { return true }
    return switch destination {
    case .profile, .collection, .messages, .connections: true
    default: false
    }
  }
  public func activeTab(account: String) -> AppTab? {
    guard let destination = path.last else { return tab }
    return switch destination {
    case .profile(let id), .collection(let id, _): id == account ? .profile : nil
    case .messages: .messages
    default: nil
    }
  }
  /// An unowned launch URL can bind to the first account. A URL owned by a
  /// different account is discarded before any private route can resolve.
  public func acceptAccount(_ account: String) {
    resetPresentation()
    if let owner = pendingRouteAccountID, owner != account { pendingRouteURL = nil }
    pendingRouteAccountID = pendingRouteURL == nil ? nil : account
  }
  public func clearAccount(preserveUnownedRoute: Bool = false) {
    resetPresentation()
    if !preserveUnownedRoute || pendingRouteAccountID != nil { pendingRouteURL = nil }
    pendingRouteAccountID = nil
  }
  public func resetPresentation() {
    routeTask?.cancel()
    routeTask = nil
    path = []
    sheet = nil
    tab = .feed
    openingLink = nil
    openingConversation = nil
  }
}

/// Account identity and verification own the lifetime of private feature state.
/// Every transition invalidates async completions, including the same account
/// moving from restricted to verified or being signed out during profile loading.
@MainActor @Observable
public final class AccountSession {
  public var profile: Profile?
  public private(set) var verificationUser: AuthUser?
  public private(set) var generation = 0
  public private(set) var verifiedRevision = 0
  private var accountID: String?
  public init() {}
  @discardableResult public func begin(_ user: AuthUser) -> Int {
    clear()
    accountID = user.id
    verificationUser = user.emailVerified ? nil : user
    return generation
  }
  public func verified(_ profile: Profile, generation: Int) throws {
    guard generation == self.generation else { throw CancellationError() }
    guard profile.id == accountID else { throw APIError.invalidResponse }
    self.profile = profile
    verificationUser = nil
    verifiedRevision += 1
  }
  public func clear() {
    generation += 1
    accountID = nil
    profile = nil
    verificationUser = nil
  }
}
