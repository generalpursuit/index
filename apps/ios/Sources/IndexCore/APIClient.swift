import Foundation

public enum APIError: LocalizedError, Sendable {
  case invalidServer, invalidResponse, unauthenticated, emailNotVerified
  case server(Int, String)
  case missingToken
  public var errorDescription: String? {
    switch self {
    case .invalidServer:
      "Configure a valid HTTPS API server. Local development may use HTTP on localhost."
    case .invalidResponse: "The server returned an unexpected response."
    case .emailNotVerified: "Verify your email to continue."
    case .unauthenticated: "Your session expired. Please sign in again."
    case .server(_, let message): message
    case .missingToken: "The server did not return a signed session token."
    }
  }
}
public enum JSONValue: Encodable, Sendable {
  case string(String)
  case bool(Bool)
  case strings([String])
  case null
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let value): try c.encode(value)
    case .bool(let value): try c.encode(value)
    case .strings(let value): try c.encode(value)
    case .null: try c.encodeNil()
    }
  }
}
/// A single native transport owns signed bearer rotation and account isolation.
/// Session cookies are disabled; credentials never enter UserDefaults or URLs.
public actor APIClient {
  public nonisolated let baseURL: URL
  private let credentials: any CredentialStore
  private let session: URLSession
  private var token: String?
  private let externallyManagedSession: Bool
  private var generation = 0
  private let responses = ResponseCache()
  public init(baseURL: URL, credentials: any CredentialStore, session: URLSession? = nil, externallyManagedSession: Bool = false) throws {
    self.baseURL = URL(string: try APIScope.normalize(baseURL.absoluteString))!
    self.externallyManagedSession = externallyManagedSession
    self.credentials = credentials
    self.token = try credentials.read()
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.timeoutIntervalForRequest = 30
    self.session =
      session ?? URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
  }
  public func request<T: Decodable & Sendable>(
    _ path: String, method: String = "GET", query: [String: String] = [:],
    body: [String: JSONValue]? = nil
  ) async throws -> T {
    if method == "GET" {
      let key = responseKey(path, query: query)
      let version = generation
      var data: Data
      while true {
        try Task.checkCancellation()
        guard version == generation else { throw CancellationError() }
        do {
          data = try await responses.load(key) {
            try await self.performData("/api/v1" + path, method: method, query: query, body: body)
          }
          break
        } catch is ResponseCache.Invalidated {
          // A write raced this read. Retry against the new state; account changes and
          // a dismissed view are checked above and must never retry in another account.
          continue
        } catch {
          if case APIError.server(let status, _) = error, [403, 404].contains(status) {
            await responses.remove(key)
          }
          throw error
        }
      }
      try Task.checkCancellation()
      guard version == generation else { throw CancellationError() }
      try checkExternalSession()
      do { return try JSONDecoder().decode(T.self, from: data) } catch {
        await responses.remove(key)
        throw APIError.invalidResponse
      }
    }
    // Read receipts do not change post, profile or message content. Other writes may
    // change access, so discard snapshots both before and after an uncertain outcome.
    let receipt = path.hasSuffix("/read")
    if !receipt { await responses.clear() }
    do {
      let value: T = try await perform("/api/v1" + path, method: method, query: query, body: body)
      if !receipt { await responses.clear() }
      try checkExternalSession()
      return value
    } catch {
      if !receipt { await responses.clear() }
      throw error
    }
  }
  public func signIn(identifier: String, password: String) async throws -> AuthSession {
    // Better Auth signs in by email and by username at separate endpoints.
    let field = identifier.contains("@") ? "email" : "username"
    return try await authenticate(
      "/api/auth/sign-in/\(field)",
      body: [field: .string(identifier), "password": .string(password)])
  }
  public func signUp(name: String, username: String, email: String, password: String) async throws
    -> AuthSession
  {
    try await authenticate(
      "/api/auth/sign-up/email",
      body: [
        "name": .string(name), "username": .string(username), "email": .string(email),
        "password": .string(password),
      ])
  }
  private func authenticate(_ path: String, body: [String: JSONValue]) async throws -> AuthSession {
    let version = generation + 1
    try await clearSession()
    guard generation == version else { throw CancellationError() }
    let result: AuthSession = try await perform(path, method: "POST", body: body)
    guard generation == version else { throw CancellationError() }
    guard token != nil else { throw APIError.missingToken }
    return result
  }
  public func restore() async throws -> AuthSession? {
    guard token != nil else { return nil }
    let version = generation
    let result: AuthSession? = try await perform("/api/auth/get-session")
    guard generation == version else { throw CancellationError() }
    if result == nil { try await clearSession() }
    else if result?.user.emailVerified == false {
      generation += 1
      let restrictedVersion = generation
      await responses.clear()
      guard generation == restrictedVersion else { throw CancellationError() }
    }
    return result
  }
  public func securityStatus() async throws -> AccountSecurityStatus {
    try await perform("/api/auth/security/status")
  }
  public func sendVerification() async throws -> CodeRequestResult {
    try await perform("/api/auth/security/send-verification", method: "POST", body: [:])
  }
  public func correctEmail(_ email: String, password: String) async throws -> CodeRequestResult {
    try await perform("/api/auth/security/correct-email", method: "POST", body: ["email": .string(email), "password": .string(password)])
  }
  public func verifyEmail(code: String) async throws {
    let _: Success = try await perform("/api/auth/security/verify-email", method: "POST", body: ["code": .string(code)])
    generation += 1
    await responses.clear()
  }
  public func requestPasswordReset(email: String) async throws -> CodeRequestResult {
    try await perform("/api/auth/security/request-reset", method: "POST", body: ["email": .string(email)])
  }
  public func resetPassword(email: String, code: String, newPassword: String) async throws {
    let _: Success = try await perform("/api/auth/security/reset-password", method: "POST", body: ["email": .string(email), "code": .string(code), "newPassword": .string(newPassword)])
    try await clearSession()
  }
  public func changePassword(currentPassword: String, newPassword: String) async throws {
    let _: Success = try await perform("/api/auth/security/change-password", method: "POST", body: ["currentPassword": .string(currentPassword), "newPassword": .string(newPassword)])
    generation += 1
    await responses.clear()
  }
  public func requestEmailChange(email: String, password: String) async throws -> CodeRequestResult {
    try await perform("/api/auth/security/request-email-change", method: "POST", body: ["email": .string(email), "password": .string(password)])
  }
  public func confirmEmailChange(code: String) async throws {
    let _: Success = try await perform("/api/auth/security/confirm-email-change", method: "POST", body: ["code": .string(code)])
    generation += 1
    await responses.clear()
  }
  public func signOut() async throws {
    // Always erase locally, and surface a Keychain failure rather than hiding it.
    let version = generation
    var requestError: Error?
    do {
      let _: Success = try await perform("/api/auth/sign-out", method: "POST", body: [:])
    } catch { requestError = error }
    guard generation == version else { throw requestError ?? CancellationError() }
    try await clearSession()
    if let requestError { throw requestError }
  }
  public func clearSession() async throws {
    generation += 1
    let version = generation
    token = nil
    await responses.clear()
    guard generation == version else { throw CancellationError() }
    if !externallyManagedSession { try credentials.write(nil) }
  }
  /// A bounded in-memory snapshot only; refresh still checks server permissions.
  public func cached<T: Decodable & Sendable>(_ path: String, query: [String: String] = [:]) async
    -> T?
  {
    let version = generation
    if externallyManagedSession && (try? credentials.read()) != token { return nil }
    guard let data = await responses.snapshot(responseKey(path, query: query)),
      version == generation
    else { return nil }
    if externallyManagedSession && (try? credentials.read()) != token { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }
  private func responseKey(_ path: String, query: [String: String]) -> String {
    var components = URLComponents()
    components.path = path
    components.queryItems = query.sorted(by: { $0.key < $1.key }).map {
      URLQueryItem(name: $0.key, value: $0.value)
    }
    return components.string!
  }
  private func perform<T: Decodable & Sendable>(
    _ path: String, method: String = "GET", query: [String: String] = [:],
    body: [String: JSONValue]? = nil
  ) async throws -> T {
    let version = generation
    let data = try await performData(path, method: method, query: query, body: body)
    guard generation == version else { throw CancellationError() }
    try checkExternalSession()
    do { return try JSONDecoder().decode(T.self, from: data) } catch {
      throw APIError.invalidResponse
    }
  }
  private func checkExternalSession() throws {
    if externallyManagedSession {
      guard token != nil, try credentials.read() == token else { throw APIError.unauthenticated }
    }
  }
  private func performData(
    _ path: String, method: String = "GET", query: [String: String] = [:],
    body: [String: JSONValue]? = nil
  ) async throws -> Data {
    let startGeneration = generation
    // An extension instance is pinned to the credential it started with. Signing in to a
    // different account requires a new client and a fresh explicit destination selection.
    if externallyManagedSession {
      guard token != nil, try credentials.read() == token else { throw APIError.unauthenticated }
    }
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
    components.path =
      components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty
      ? path : components.path + path
    components.queryItems =
      query.isEmpty
      ? nil
      : query.sorted(by: { $0.key < $1.key }).map { URLQueryItem(name: $0.key, value: $0.value) }
    guard let url = components.url else { throw APIError.invalidServer }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      request.httpBody = try JSONEncoder().encode(body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (data, response) = try await session.data(for: request)
    try Task.checkCancellation()
    if externallyManagedSession {
      guard try credentials.read() == token else { throw APIError.unauthenticated }
    }
    guard generation == startGeneration else { throw CancellationError() }
    guard let response = response as? HTTPURLResponse else { throw APIError.invalidResponse }
    guard (200..<300).contains(response.statusCode) else {
      if response.statusCode == 401, token != nil {
        try await clearSession()
        throw APIError.unauthenticated
      }
      let errorBody = try? JSONDecoder().decode(ErrorBody.self, from: data)
      if response.statusCode == 403,
        errorBody?.code == "EMAIL_NOT_VERIFIED" || errorBody?.data?.code == "EMAIL_NOT_VERIFIED" {
        generation += 1
        await responses.clear()
        // Retain the signed credential only for verification/resume/sign-out.
        throw APIError.emailNotVerified
      }
      let message =
        errorBody?.message
        ?? "Request failed (\(response.statusCode)). Please try again."
      throw APIError.server(response.statusCode, message)
    }
    if !externallyManagedSession, let signed = response.value(forHTTPHeaderField: "set-auth-token"), !signed.isEmpty {
      try credentials.write(signed)
      token = signed
    }
    return data
  }
}

private struct ErrorBody: Decodable {
  let message: String?
  let code: String?
  let data: ErrorData?
}
private struct ErrorData: Decodable { let code: String? }

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
