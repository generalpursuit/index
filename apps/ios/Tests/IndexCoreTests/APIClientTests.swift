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
/// URLProtocol receives upload bodies as a stream.
private func body(of request: URLRequest) -> Data {
  if let data = request.httpBody { return data }
  guard let stream = request.httpBodyStream else { return Data() }
  stream.open(); defer { stream.close() }
  var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
  while stream.hasBytesAvailable {
    let read = stream.read(&buffer, maxLength: buffer.count)
    if read <= 0 { break }
    data.append(buffer, count: read)
  }
  return data
}
@Suite(.serialized)
struct APIClientTests {
  func make(_ credentials: any CredentialStore = MemoryCredentials(), responses: ResponseCache = ResponseCache()) throws -> APIClient {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [HTTPStub.self]
    return try APIClient(
      baseURL: URL(string: "https://api.example.com")!, credentials: credentials,
      session: URLSession(configuration: config), responses: responses)
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
  @Test func snapshotsAreAccountScopedAndWritesInvalidateAffectedResources() async throws {
    let client = try make(MemoryCredentials("alice.signed"))
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/private", query: ["a": "1", "b": "2"])
    let cached: Success? = await client.cached("/private", query: ["b": "2", "a": "1"])
    #expect(cached?.success == true)
    let _: Success = try await client.request("/links/test", method: "PATCH", body: [:])
    let afterWrite: Success? = await client.cached("/private", query: ["a": "1", "b": "2"])
    #expect(afterWrite?.success == true)
    let _: Success = try await client.request("/private")
    HTTPStub.handler = { _ in throw URLError(.notConnectedToInternet) }
    await #expect(throws: URLError.self) { try await client.signOut() }
    let afterLogout: Success? = await client.cached("/private")
    #expect(afterLogout == nil)
  }
  @Test func housekeepingPreservesContentAndLinkWritesKeepMessages() async throws {
    let client = try make(MemoryCredentials("alice.signed"))
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/links/a")
    let _: Success = try await client.request("/conversations/a/messages")
    for path in ["/me/notifications/active", "/conversations/a/read", "/me/activity/read"] {
      let _: Success = try await client.request(path, method: "POST", body: [:])
      let content: Success? = client.cached("/links/a")
      #expect(content?.success == true)
    }
    let _: Success = try await client.request("/links/a/favorite", method: "POST", body: [:])
    let post: Success? = client.cached("/links/a")
    let messages: Success? = client.cached("/conversations/a/messages")
    #expect(post == nil)
    #expect(messages?.success == true)
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
  @Test func identifiesItsReleaseAndReportsRequiredUpdatesWithoutSigningOut() async throws {
    final class Signal: @unchecked Sendable {
      private let lock = NSLock()
      private var count = 0
      func fire() { lock.withLock { count += 1 } }
      var fired: Int { lock.withLock { count } }
    }
    let signal = Signal()
    let credentials = MemoryCredentials("alice.signed")
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [HTTPStub.self]
    let client = try APIClient(
      baseURL: URL(string: "https://api.example.com")!, credentials: credentials,
      session: URLSession(configuration: config), onUpdateRequired: { signal.fire() }, responses: ResponseCache())
    HTTPStub.handler = { request in
      #expect(request.value(forHTTPHeaderField: "X-Index-Client")?.contains("/") == true)
      return (426, [:], Data(#"{"code":"CLIENT_UPDATE_REQUIRED","message":"Update Index to continue."}"#.utf8))
    }
    do {
      let _: Success = try await client.request("/test")
      Issue.record("An unsupported release unexpectedly reached the API")
    } catch APIError.updateRequired {}
    #expect(signal.fired == 1)
    #expect(try credentials.read() == "alice.signed")
  }
  @Test func uploadsAFileAsSignedMultipartAndDownloadsBytes() async throws {
    HTTPStub.handler = { request in
      if request.httpMethod == "POST" {
        #expect(request.url?.path == "/api/v1/conversations/c/files")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer signed-token.signature")
        #expect(request.value(forHTTPHeaderField: "X-Index-Client")?.isEmpty == false)
        let type = request.value(forHTTPHeaderField: "Content-Type") ?? ""
        #expect(type.hasPrefix("multipart/form-data; boundary="))
        let text = String(decoding: body(of: request), as: UTF8.self)
        #expect(text.contains(#"name="file"; filename="beach.jpg""#))
        #expect(text.contains("Content-Type: image/jpeg"))
        #expect(text.contains("Content-Disposition: form-data; name=\"width\"\r\n\r\n1200\r\n"))
        // The server stores the whole file before it answers.
        #expect(request.timeoutInterval == 120)
        let json = #"{"id":"f","name":"beach.jpg","type":"image/jpeg","size":3,"width":1200,"height":800}"#
        return (200, [:], Data(json.utf8))
      }
      #expect(request.url?.path == "/api/v1/conversations/c/files/f")
      return (200, ["Content-Type": "image/jpeg"], Data([1, 2, 3]))
    }
    let api = try make(MemoryCredentials("signed-token.signature"))
    let file: MessageFile = try await api.upload(
      "/conversations/c/files", file: UploadFile(name: "beach.jpg", type: "image/jpeg", data: Data([1, 2, 3])),
      fields: ["width": "1200", "height": "800"])
    #expect(file.id == "f")
    #expect(try await api.download("/conversations/c/files/f") == Data([1, 2, 3]))
  }
  @Test func multipartNamesCannotBreakTheirHeaders() {
    let body = Multipart.body(
      file: UploadFile(name: "a\"b\\c\r\n.pdf", type: "application/pdf\r\nX-Injected: 1", data: Data([1])),
      fields: [:], boundary: "b")
    let lines = String(decoding: body, as: UTF8.self).components(separatedBy: "\r\n")
    #expect(lines.contains(#"Content-Disposition: form-data; name="file"; filename="a'b-c.pdf""#))
    #expect(lines.contains("Content-Type: application/pdfX-Injected: 1"))
    #expect(!lines.contains("X-Injected: 1"))
    let accented = Multipart.body(
      file: UploadFile(name: "Menü für Sonntag 日曜.pdf", type: "application/pdf", data: Data()), fields: [:], boundary: "b")
    #expect(String(decoding: accented, as: UTF8.self).components(separatedBy: "\r\n")
      .contains(#"Content-Disposition: form-data; name="file"; filename="Menü für Sonntag 日曜.pdf""#))
  }
  @Test func expiresAndClearsCredentials() async throws {
    let credentials = MemoryCredentials("expired.signature")
    let client = try make(credentials)
    HTTPStub.handler = { _ in (401, [:], Data(#"{"message":"expired"}"#.utf8)) }
    await #expect(throws: APIError.self) { let _: Success = try await client.request("/private") }
    #expect(try credentials.read() == nil)
  }
  @Test func logoutErasesLocallyBeforeSendingItsCapturedCredential() async throws {
    let credentials = MemoryCredentials("signed.signature")
    let client = try make(credentials)
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/links/a")
    HTTPStub.handler = { request in
      let stored = try credentials.read()
      #expect(stored == nil)
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer signed.signature")
      let cached: Success? = client.cached("/links/a")
      #expect(cached == nil)
      return (200, [:], Data(#"{"success":true}"#.utf8))
    }
    try await client.signOut()
  }
  @Test func repeatedExpiredReadsStillReportSessionExpiryAfterCredentialErasure() async throws {
    let client = try make(MemoryCredentials("expired.signature"))
    HTTPStub.handler = { _ in (401, [:], Data(#"{"message":"Expired"}"#.utf8)) }
    for _ in 0..<2 {
      do {
        let _: Success = try await client.request("/me/pulse")
        Issue.record("Expired session unexpectedly succeeded")
      } catch APIError.unauthenticated {}
    }
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
  private func coldCache(_ directory: URL) async throws -> ResponseCache {
    let cache = ResponseCache(directory: directory)
    await cache.accept(scope: "https://api.example.com", account: "alice")
    _ = try await cache.load("/me/profile?") {
      Data(#"{"id":"alice","name":"Alice","profileVisibility":"public","canViewContent":true,"followedBy":{"users":[],"total":0}}"#.utf8)
    }
    _ = try await cache.load("/conversations/chat/messages?limit=30") { Data(#"{"success":true}"#.utf8) }
    return ResponseCache(directory: directory)
  }
  private func diskFiles(_ directory: URL) throws -> [String: Data] {
    let files = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.isRegularFileKey])
    var result: [String: Data] = [:]
    for case let file as URL in files?.allObjects ?? [] {
      if try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
        result[file.path] = try Data(contentsOf: file)
      }
    }
    return result
  }
  @Test func provisionalLaunchReadsDiskWithoutRequestsOrWritesUntilVerification() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = try await coldCache(directory)
    let before = try diskFiles(directory)
    HTTPStub.handler = { _ in Issue.record("Provisional content must not send a request"); throw URLError(.notConnectedToInternet) }
    let client = try make(MemoryCredentials("alice.signed"), responses: cache)
    #expect(client.provisionalAccountID == "alice")
    let profile: Profile? = client.cached("/me/profile")
    #expect(profile?.name == "Alice")
    let messages: Success? = client.cached("/conversations/chat/messages", query: ["limit": "30"])
    #expect(messages?.success == true)
    for method in ["GET", "POST"] {
      do { let _: Success = try await client.request("/links/new", method: method); Issue.record("Provisional request unexpectedly succeeded") }
      catch APIError.sessionNotVerified {}
    }
    do { _ = try await client.securityStatus(); Issue.record("Provisional security request unexpectedly succeeded") }
    catch APIError.sessionNotVerified {}
    do { _ = try await cache.load("/links/new") { Issue.record("Provisional load invoked transport"); return Data() }; Issue.record("Provisional cache load succeeded") }
    catch APIError.sessionNotVerified {}
    #expect(!cache.snapshots.store(Data(), key: "/links/new", version: cache.snapshots.ticket("/links/new")))
    #expect(try diskFiles(directory) == before)
    HTTPStub.handler = { request in
      #expect(request.url?.path == "/api/auth/get-session")
      return (200, [:], Data(#"{"user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":true}}"#.utf8))
    }
    #expect(try await client.restore()?.user.id == "alice")
    #expect(client.provisionalAccountID == nil)
    let preserved: Profile? = client.cached("/me/profile")
    #expect(preserved?.name == "Alice")
    HTTPStub.handler = { _ in (200, [:], Data(#"{"success":true}"#.utf8)) }
    let _: Success = try await client.request("/links/new")
    let new: Success? = client.cached("/links/new")
    #expect(new?.success == true)
  }
  @Test func transientVerificationKeepsCachedContentAndRememberedAccountForRetry() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = try await coldCache(directory)
    let client = try make(MemoryCredentials("alice.signed"), responses: cache)
    let before = try diskFiles(directory)
    for failure in [URLError(.notConnectedToInternet) as Error, APIError.server(503, "Unavailable")] {
      HTTPStub.handler = { request in #expect(request.url?.path == "/api/auth/get-session"); throw failure }
      await #expect(throws: (any Error).self) { try await client.restore() }
      #expect(client.provisionalAccountID == "alice")
      let profile: Profile? = client.cached("/me/profile")
      #expect(profile?.name == "Alice")
      #expect(try diskFiles(directory) == before)
    }
  }
  @Test func mismatchedVerificationErasesOldContentAndRequiresSignIn() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = try await coldCache(directory)
    let credentials = MemoryCredentials("bob.signed")
    let client = try make(credentials, responses: cache)
    #expect(client.provisionalAccountID == "alice")
    HTTPStub.handler = { _ in
      (200, [:], Data(#"{"user":{"id":"bob","name":"Bob","email":"bob@example.com","emailVerified":true}}"#.utf8))
    }
    do { _ = try await client.restore(); Issue.record("Mismatched account must sign in again") }
    catch APIError.unauthenticated {}
    #expect(try credentials.read() == nil)
    let old: Profile? = client.cached("/me/profile")
    #expect(old == nil)
    #expect(cache.snapshots.provisionalAccount == nil)
    let relaunched = ResponseCache(directory: directory)
    #expect(relaunched.snapshots.provision(scope: "https://api.example.com") == nil)
    #expect(relaunched.snapshot("/me/profile?") == nil)
    await relaunched.clear()
    #expect(ResponseCache(directory: directory).snapshots.provision(scope: "https://api.example.com") == nil)
  }
  @Test func restrictedExpiredAndNullVerificationEraseContentAndRememberedAccount() async throws {
    for kind in ["restricted", "expired", "null", "forbidden"] {
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      defer { try? FileManager.default.removeItem(at: directory) }
      let cache = try await coldCache(directory)
      let credentials = MemoryCredentials("alice.signed")
      let client = try make(credentials, responses: cache)
      HTTPStub.handler = { _ in
        switch kind {
        case "restricted": (200, [:], Data(#"{"user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":false}}"#.utf8))
        case "expired": (401, [:], Data())
        case "forbidden": (403, [:], Data(#"{"message":"Restricted session"}"#.utf8))
        default: (200, [:], Data("null".utf8))
        }
      }
      do {
        let restored = try await client.restore()
        #expect(kind == "restricted" ? restored?.user.emailVerified == false : restored == nil)
      } catch APIError.unauthenticated { #expect(kind == "expired" || kind == "forbidden") }
      #expect(cache.snapshot("/me/profile?") == nil)
      #expect(cache.snapshot("/conversations/chat/messages?limit=30") == nil)
      #expect(client.provisionalAccountID == nil)
      #expect(ResponseCache(directory: directory).snapshots.provision(scope: "https://api.example.com") == nil)
      #expect(try credentials.read() == (kind == "restricted" ? "alice.signed" : nil))
    }
  }
  @Test func signOutAndInterruptedSignInNeverPairOldCacheWithNewToken() async throws {
    for operation in ["sign-out", "sign-in"] {
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      defer { try? FileManager.default.removeItem(at: directory) }
      let cache = try await coldCache(directory)
      let credentials = MemoryCredentials("alice.signed")
      let client = try make(credentials, responses: cache)
      HTTPStub.handler = { request in
        #expect(cache.snapshot("/me/profile?") == nil)
        #expect(try credentials.read() == nil)
        #expect(ResponseCache(directory: directory).snapshots.provision(scope: "https://api.example.com") == nil)
        if operation == "sign-out" {
          #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer alice.signed")
          throw URLError(.notConnectedToInternet)
        }
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        // A signed header can arrive before an invalid/interrupted body is accepted.
        return (200, ["set-auth-token": "bob.signed"], Data(#"{"invalid":true}"#.utf8))
      }
      do {
        if operation == "sign-out" { try await client.signOut() }
        else { _ = try await client.signIn(identifier: "bob", password: "password") }
        Issue.record("Expected interrupted authentication")
      } catch {}
      let relaunched = try make(credentials, responses: ResponseCache(directory: directory))
      #expect(relaunched.provisionalAccountID == nil)
      let old: Profile? = relaunched.cached("/me/profile")
      #expect(old == nil)
    }
  }
  @Test func tokenlessLaunchAndShareExtensionDoNotUseRememberedAccount() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = try await coldCache(directory)
    let tokenless = try make(MemoryCredentials(), responses: cache)
    #expect(tokenless.provisionalAccountID == nil)
    let profile: Profile? = tokenless.cached("/me/profile")
    #expect(profile == nil)
    let before = try diskFiles(directory)
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [HTTPStub.self]
    let share = try APIClient(baseURL: URL(string: "https://api.example.com")!, credentials: MemoryCredentials("alice.signed"), session: URLSession(configuration: config), externallyManagedSession: true)
    #expect(share.provisionalAccountID == nil)
    HTTPStub.handler = { _ in (200, [:], Data(#"{"user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":true}}"#.utf8)) }
    _ = try await share.restore()
    try await share.clearSession()
    #expect(try diskFiles(directory) == before)
    #expect(ResponseCache(directory: directory).snapshots.provision(scope: "https://api.example.com") == "alice")
  }
  @Test func lateVerificationCannotRestoreContentOrRotateTokenAfterSignOut() async throws {
    final class Gate: @unchecked Sendable {
      private let lock = NSLock()
      private let finished = DispatchSemaphore(value: 0)
      private var waiting = false
      var started: Bool { lock.withLock { waiting } }
      func pause() {
        lock.withLock { waiting = true }
        #expect(finished.wait(timeout: .now() + 10) == .success)
      }
      func resume() { finished.signal() }
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = try await coldCache(directory)
    let credentials = MemoryCredentials("alice.signed")
    let client = try make(credentials, responses: cache)
    let gate = Gate()
    HTTPStub.handler = { _ in
      gate.pause()
      return (200, ["set-auth-token": "late.signed"], Data(#"{"user":{"id":"alice","name":"Alice","email":"alice@example.com","emailVerified":true}}"#.utf8))
    }
    let verification = Task { try await client.restore() }
    while !gate.started { await Task.yield() }
    try await client.clearSession()
    gate.resume()
    do { _ = try await verification.value; Issue.record("Late verification unexpectedly restored the session") }
    catch is CancellationError {}
    #expect(try credentials.read() == nil)
    #expect(client.provisionalAccountID == nil)
    let profile: Profile? = client.cached("/me/profile")
    #expect(profile == nil)
    #expect(ResponseCache(directory: directory).snapshots.provision(scope: "https://api.example.com") == nil)
  }
  @Test func restrictedAttachmentHasOnlyAuthorIdentity() throws {
    let json =
      #"{"id":"message","conversationId":"conversation","senderId":"alice","clientId":"client","body":"A find","createdAt":"2026-01-01T00:00:00.000Z","attachment":null,"hasAttachment":true,"files":[],"restrictedAuthor":{"id":"iris","name":"Iris","username":"iris","image":null,"profileVisibility":"private"}}"#
    let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    #expect(message.attachment == nil)
    #expect(message.hasAttachment)
    #expect(message.restrictedAuthor?.id == "iris")
  }
  @Test func messageFilesDecodeInOrderAndNameThemselves() throws {
    let json = #"""
      {"id":"m","conversationId":"c","senderId":"alice","clientId":"m","body":"","createdAt":"2026-10-17T10:00:00.000Z",
       "attachment":null,"hasAttachment":false,"restrictedAuthor":null,"replyTo":null,
       "files":[{"id":"a","name":"beach.png","type":"image/png","size":2048,"width":1200,"height":800},
                {"id":"b","name":"Sunday menu.pdf","type":"application/octet-stream","size":245760,"width":null,"height":null}]}
      """#
    let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    #expect(message.files.map(\.id) == ["a", "b"])
    #expect(message.files[0].isPhoto && !message.files[1].isPhoto)
    #expect(message.files.summary == "2 files")
    #expect([message.files[0]].summary == "Photo")
    #expect([message.files[1]].summary == "Sunday menu.pdf")
    #expect(message.files[1].details.hasPrefix("PDF · "))
  }
  @Test func replyCarriesOnlyItsQuoteAndConversationItsReadReceipt() throws {
    let json =
      #"{"id":"conversation","shortId":"AbCdEfGhIjKlMnOp","participants":[],"canSend":true,"unreadCount":0,"readReceiptMessageId":"reply","lastMessage":{"id":"reply","conversationId":"conversation","senderId":"alice","clientId":"client","body":"Yes","createdAt":"2026-10-13T09:00:00.000Z","attachment":null,"hasAttachment":false,"files":[],"restrictedAuthor":null,"replyTo":{"id":"original","senderId":"bob","excerpt":"","hasAttachment":true,"files":[]}},"updatedAt":"2026-10-13T09:00:00.000Z"}"#
    let conversation = try JSONDecoder().decode(Conversation.self, from: Data(json.utf8))
    #expect(conversation.readReceiptMessageId == "reply")
    let quote = try #require(conversation.lastMessage?.replyTo)
    #expect(quote.id == "original")
    #expect(quote.senderId == "bob")
    #expect(quote.excerpt.isEmpty)
    #expect(quote.hasAttachment)
    // A deleted original is no longer quoted, and nothing has been read yet.
    let unquoted = json.replacingOccurrences(
      of: #"{"id":"original","senderId":"bob","excerpt":"","hasAttachment":true,"files":[]}"#, with: "null"
    ).replacingOccurrences(of: #""readReceiptMessageId":"reply""#, with: #""readReceiptMessageId":null"#)
    let unread = try JSONDecoder().decode(Conversation.self, from: Data(unquoted.utf8))
    #expect(unread.lastMessage?.replyTo == nil)
    #expect(unread.readReceiptMessageId == nil)
  }
  @Test func replyLabelsNameWhoIsAnsweredForTheReader() throws {
    let json =
      #"{"id":"conversation","participants":[{"id":"alice","name":"Alice Doe","profileVisibility":"public"},{"id":"bob","name":"Bob Roe","profileVisibility":"public"}],"canSend":true,"unreadCount":0,"updatedAt":"2026-10-13T09:00:00.000Z"}"#
    let conversation = try JSONDecoder().decode(Conversation.self, from: Data(json.utf8))
    #expect(conversation.replyLabel(viewerId: "alice", from: "alice", to: "bob") == "Replying to Bob Roe")
    #expect(conversation.replyLabel(viewerId: "alice", from: "bob", to: "alice") == "Replying to you")
    #expect(conversation.replyLabel(viewerId: "alice", from: "alice", to: "alice") == "Replying to yourself")
    #expect(conversation.replyLabel(viewerId: "alice", from: "bob", to: "gone") == "Replying to a former participant")
    let post = try JSONDecoder().decode(
      MessageReply.self, from: Data(#"{"id":"m","senderId":"bob","excerpt":"","hasAttachment":true,"files":[]}"#.utf8))
    #expect(post.preview == "Shared post")
  }
}
