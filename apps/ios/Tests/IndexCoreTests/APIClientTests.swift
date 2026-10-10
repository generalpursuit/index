import Foundation
import Testing

@testable import IndexCore

final class MemoryCredentials: CredentialStore, @unchecked Sendable {
  private let lock = NSLock()
  private var token: String?
  init(_ token: String? = nil) { self.token = token }
  func read() throws -> String? { lock.withLock { token } }
  func write(_ token: String?) throws { lock.withLock { self.token = token } }
}
private final class HTTPStub: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var handler:
    (@Sendable (URLRequest) throws -> (Int, [String: String], Data))?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let (status, headers, data) = try Self.handler!(request)
      client?.urlProtocol(
        self,
        didReceive: HTTPURLResponse(
          url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!,
        cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
}
@Suite(.serialized)
struct APIClientTests {
  func make(_ credentials: any CredentialStore = MemoryCredentials()) throws -> APIClient {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [HTTPStub.self]
    return try APIClient(
      baseURL: URL(string: "https://api.example.com")!, credentials: credentials,
      session: URLSession(configuration: config))
  }
  @Test func extensionRejectsAccountChangeAndNeverRotatesOrDeletesHostToken() async throws {
    let credentials = MemoryCredentials("alice.signed")
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [HTTPStub.self]
    let client = try APIClient(baseURL: URL(string: "https://api.example.com")!, credentials: ReadOnlyCredentials(credentials), session: URLSession(configuration: config), externallyManagedSession: true)
    HTTPStub.handler = { _ in (200, ["set-auth-token": "rotated.signed"], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/test")
    #expect(try credentials.read() == "alice.signed")
    HTTPStub.handler = { _ in
      try credentials.write("bob.signed")
      return (200, ["set-auth-token": "stale.signed"], Data(#"{"success":true}"#.utf8))
    }
    await #expect(throws: APIError.self) { let _: Success = try await client.request("/test") }
    #expect(try credentials.read() == "bob.signed")
    HTTPStub.handler = { _ in Issue.record("Should reject before network"); return (401, [:], Data()) }
    await #expect(throws: APIError.self) { let _: Success = try await client.request("/test", method: "POST", body: [:]) }
    #expect(try credentials.read() == "bob.signed")
  }
  @Test func snapshotsAreAccountScopedAndWritesInvalidateThem() async throws {
    let client = try make(MemoryCredentials("alice.signed"))
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/private", query: ["a": "1", "b": "2"])
    let cached: Success? = await client.cached("/private", query: ["b": "2", "a": "1"])
    #expect(cached?.success == true)
    let _: Success = try await client.request("/links/test", method: "PATCH", body: [:])
    let afterWrite: Success? = await client.cached("/private", query: ["a": "1", "b": "2"])
    #expect(afterWrite == nil)
    let _: Success = try await client.request("/private")
    HTTPStub.handler = { _ in throw URLError(.notConnectedToInternet) }
    await #expect(throws: URLError.self) { try await client.signOut() }
    let afterLogout: Success? = await client.cached("/private")
    #expect(afterLogout == nil)
  }
  @Test func revokedReadsEvictSnapshots() async throws {
    let client = try make(MemoryCredentials("alice.signed"))
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/private")
    HTTPStub.handler = { _ in (404, [:], Data(#"{"message":"Not found"}"#.utf8)) }
    await #expect(throws: APIError.self) { let _: Success = try await client.request("/private") }
    let cached: Success? = await client.cached("/private")
    #expect(cached == nil)
  }
  @Test func systemKeychainRoundTrip() throws {
    let store = KeychainCredentials(
      server: URL(string: "https://native-test-\(UUID().uuidString.lowercased()).invalid")!)
    defer { try? store.write(nil) }
    #expect(try store.read() == nil)
    try store.write("test-only.signed-token")
    #expect(try store.read() == "test-only.signed-token")
    try store.write(nil)
    #expect(try store.read() == nil)
  }

  @Test func rejectsInsecureRemoteServer() {
    #expect(throws: APIError.self) {
      try APIClient(
        baseURL: URL(string: "http://api.example.com")!, credentials: MemoryCredentials())
    }
  }
  @Test func retainsSignedHeaderRatherThanJSONToken() async throws {
    let credentials = MemoryCredentials()
    let client = try make(credentials)
    HTTPStub.handler = { request in
      #expect(request.url?.path == "/api/auth/sign-in/email")
      return (
        200, ["set-auth-token": "signed-token.signature"],
        Data(
          #"{"token":"unsigned-do-not-use","user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":true}}"#
            .utf8)
      )
    }
    let _ = try await client.signIn(identifier: "alice@example.com", password: "test-password")
    #expect(try credentials.read() == "signed-token.signature")
    HTTPStub.handler = { request in
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer signed-token.signature")
      #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
      return (200, ["set-auth-token": "rotated.signature"], Data(#"{"success":true}"#.utf8))
    }
    let _: Success = try await client.request("/test")
    #expect(try credentials.read() == "rotated.signature")
  }
  @Test func expiresAndClearsCredentials() async throws {
    let credentials = MemoryCredentials("expired.signature")
    let client = try make(credentials)
    HTTPStub.handler = { _ in (401, [:], Data(#"{"message":"expired"}"#.utf8)) }
    await #expect(throws: APIError.self) { let _: Success = try await client.request("/private") }
    #expect(try credentials.read() == nil)
  }
  @Test func offlineLogoutErasesCredentials() async throws {
    let credentials = MemoryCredentials("signed.signature")
    let client = try make(credentials)
    HTTPStub.handler = { _ in throw URLError(.notConnectedToInternet) }
    await #expect(throws: URLError.self) { try await client.signOut() }
    #expect(try credentials.read() == nil)
  }
  @Test func logoutReportsCredentialDeletionFailure() async throws {
    struct LockedCredentials: CredentialStore {
      func read() throws -> String? { "signed.signature" }
      func write(_ token: String?) throws { throw CocoaError(.fileWriteNoPermission) }
    }
    let client = try make(LockedCredentials())
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    await #expect(throws: CocoaError.self) { try await client.signOut() }
  }
  @Test func signsInWithUsernameAtItsOwnEndpoint() async throws {
    let client = try make()
    HTTPStub.handler = { request in
      #expect(request.url?.path == "/api/auth/sign-in/username")
      return (
        200, ["set-auth-token": "signed-token.signature"],
        Data(
          #"{"token":"unsigned","user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":true}}"#
            .utf8)
      )
    }
    let _ = try await client.signIn(identifier: "alice", password: "test-password")
  }
  @Test func invalidPasswordPreservesSignInError() async throws {
    let client = try make()
    HTTPStub.handler = { _ in (401, [:], Data(#"{"message":"Invalid email or password"}"#.utf8)) }
    do {
      let _ = try await client.signIn(identifier: "alice@example.com", password: "wrong")
      Issue.record("Invalid password unexpectedly succeeded")
    } catch APIError.server(let status, let message) {
      #expect(status == 401)
      #expect(message == "Invalid email or password")
    }
  }
  @Test func emptySessionErasesCredentials() async throws {
    let credentials = MemoryCredentials("signed.signature")
    let client = try make(credentials)
    HTTPStub.handler = { _ in (200, [:], Data("null".utf8)) }
    #expect(try await client.restore() == nil)
    #expect(try credentials.read() == nil)
  }
  @Test func rejectsUnsignedOnlySignIn() async throws {
    let client = try make()
    HTTPStub.handler = { _ in
      (
        200, [:],
        Data(
          #"{"token":"unsigned","user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":true}}"#
            .utf8)
      )
    }
    await #expect(throws: APIError.self) {
      let _ = try await client.signIn(identifier: "alice@example.com", password: "test-password")
    }
  }
  @Test func escapesQueryText() async throws {
    let client = try make()
    HTTPStub.handler = { request in
      let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
      #expect(components.queryItems?.first?.value == "a&b+? /é")
      return (200, [:], Data(#"{"success":true}"#.utf8))
    }
    let _: Success = try await client.request("/discovery/users", query: ["query": "a&b+? /é"])
  }
  @Test func restrictedSessionRestoresWithoutLosingSignedCredential() async throws {
    let credentials = MemoryCredentials("restricted.signature")
    let client = try make(credentials)
    HTTPStub.handler = { request in
      #expect(request.url?.path == "/api/auth/get-session")
      return (200, [:], Data(#"{"user":{"id":"alice","name":"Alice","email":"mistake@example.com","emailVerified":false}}"#.utf8))
    }
    let restored = try await client.restore()
    #expect(restored?.user.emailVerified == false)
    #expect(try credentials.read() == "restricted.signature")
  }
  @Test func unverifiedAPIErrorClearsContentButRetainsVerificationCredential() async throws {
    let credentials = MemoryCredentials("restricted.signature")
    let client = try make(credentials)
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/private")
    HTTPStub.handler = { _ in (403, [:], Data(#"{"code":"FORBIDDEN","message":"Verify your email to continue.","data":{"code":"EMAIL_NOT_VERIFIED"}}"#.utf8)) }
    do {
      let _: Success = try await client.request("/private")
      Issue.record("Restricted session unexpectedly reached app API")
    } catch APIError.emailNotVerified {}
    let cached: Success? = await client.cached("/private")
    #expect(cached == nil)
    #expect(try credentials.read() == "restricted.signature")
  }
  @Test func verificationAndCorrectionUseSignedSessionWithoutPasswordlessLogin() async throws {
    let credentials = MemoryCredentials("restricted.signature")
    let client = try make(credentials)
    HTTPStub.handler = { request in
      #expect(request.url?.path == "/api/auth/security/correct-email")
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer restricted.signature")
      return (200, [:], Data(#"{"success":true,"retryAfter":60}"#.utf8))
    }
    let response = try await client.correctEmail("correct@example.com", password: "signup-password")
    #expect(response.retryAfter == 60)
    HTTPStub.handler = { request in
      #expect(request.url?.path == "/api/auth/security/verify-email")
      return (200, [:], Data(#"{"success":true}"#.utf8))
    }
    try await client.verifyEmail(code: "123456")
    #expect(try credentials.read() == "restricted.signature")
  }
  @Test func sameAccountVerificationRestoresReadinessForThePendingURL() async throws {
    let credentials = MemoryCredentials("restricted.signature")
    let client = try make(credentials)
    let pending = ReadableRouteRequest(url: URL(string: "index://u/alice/reading")!, webOrigins: [])!
    HTTPStub.handler = { _ in
      (200, [:], Data(#"{"user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":false}}"#.utf8))
    }
    let restricted = try await client.restore()
    #expect(!ReadableRouteReadiness.canResolve(userID: restricted?.user.id, emailVerified: restricted?.user.emailVerified == true))
    HTTPStub.handler = { request in
      #expect(request.url?.path == "/api/auth/security/verify-email")
      return (200, [:], Data(#"{"success":true}"#.utf8))
    }
    try await client.verifyEmail(code: "123456")
    HTTPStub.handler = { _ in
      (200, [:], Data(#"{"user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":true}}"#.utf8))
    }
    let verified = try await client.restore()
    #expect(verified?.user.id == restricted?.user.id)
    #expect(ReadableRouteReadiness.canResolve(userID: verified?.user.id, emailVerified: verified?.user.emailVerified == true))
    #expect(pending.path == "/u/alice/reading")
    #expect(try credentials.read() == "restricted.signature")
  }
  @Test func resetErasesExistingCredentialAndCacheWithoutCreatingASession() async throws {
    let credentials = MemoryCredentials("old.signature")
    let client = try make(credentials)
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/private")
    HTTPStub.handler = { request in
      #expect(request.url?.path == "/api/auth/security/reset-password")
      return (200, [:], Data(#"{"success":true}"#.utf8))
    }
    try await client.resetPassword(email: "alice@example.com", code: "123456", newPassword: "new-password")
    #expect(try credentials.read() == nil)
    let cached: Success? = await client.cached("/private")
    #expect(cached == nil)
  }
  @Test func failedCodePreservesInterruptedVerificationSession() async throws {
    let credentials = MemoryCredentials("restricted.signature")
    let client = try make(credentials)
    HTTPStub.handler = { _ in (400, [:], Data(#"{"message":"That code is incorrect or expired."}"#.utf8)) }
    await #expect(throws: APIError.self) { try await client.verifyEmail(code: "000000") }
    #expect(try credentials.read() == "restricted.signature")
  }
  @Test func UTCWeeksCrossYearBoundary() {
    #expect(Week.monday(Week.date("2026-01-01")) == "2025-12-29")
    #expect(Week.label("2025-12-29") == "Week 1")
    #expect(Week.shift("2025-12-29", by: 1) == "2026-01-05")
  }
  @Test func restrictedAttachmentHasOnlyAuthorIdentity() throws {
    let json =
      #"{"id":"message","conversationId":"conversation","senderId":"alice","clientId":"client","body":"A find","createdAt":"2026-01-01T00:00:00.000Z","attachment":null,"hasAttachment":true,"restrictedAuthor":{"id":"iris","name":"Iris","username":"iris","image":null,"profileVisibility":"private"}}"#
    let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    #expect(message.attachment == nil)
    #expect(message.hasAttachment)
    #expect(message.restrictedAuthor?.id == "iris")
  }
}
