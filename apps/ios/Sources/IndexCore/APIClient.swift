import Foundation

public enum APIError: LocalizedError, Sendable {
  case invalidServer, invalidResponse, unauthenticated
  case server(Int, String)
  case missingToken
  public var errorDescription: String? {
    switch self {
    case .invalidServer:
      "Configure a valid HTTPS API server. Local development may use HTTP on localhost."
    case .invalidResponse: "The server returned an unexpected response."
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
  public let baseURL: URL
  private let credentials: any CredentialStore
  private let session: URLSession
  private var token: String?
  private var generation = 0
  private let responses = ResponseCache()
  public init(baseURL: URL, credentials: any CredentialStore, session: URLSession? = nil) throws {
    guard baseURL.host != nil, baseURL.user == nil, baseURL.password == nil,
      baseURL.scheme == "https"
        || (baseURL.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(baseURL.host!))
    else { throw APIError.invalidServer }
    self.baseURL = baseURL
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
    try await clearSession()
    let result: AuthSession = try await perform(path, method: "POST", body: body)
    guard token != nil else { throw APIError.missingToken }
    return result
  }
  public func restore() async throws -> AuthSession? {
    guard token != nil else { return nil }
    let result: AuthSession? = try await perform("/api/auth/get-session")
    if result == nil { try await clearSession() }
    return result
  }
  public func signOut() async throws {
    // Always erase locally, and surface a Keychain failure rather than hiding it.
    var requestError: Error?
    do {
      let _: Success = try await perform("/api/auth/sign-out", method: "POST", body: [:])
    } catch { requestError = error }
    try await clearSession()
    if let requestError { throw requestError }
  }
  public func clearSession() async throws {
    generation += 1
    token = nil
    await responses.clear()
    try credentials.write(nil)
  }
  /// A bounded in-memory snapshot only; refresh still checks server permissions.
  public func cached<T: Decodable & Sendable>(_ path: String, query: [String: String] = [:]) async
    -> T?
  {
    let version = generation
    guard let data = await responses.snapshot(responseKey(path, query: query)),
      version == generation
    else { return nil }
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
    let data = try await performData(path, method: method, query: query, body: body)
    do { return try JSONDecoder().decode(T.self, from: data) } catch {
      throw APIError.invalidResponse
    }
  }
  private func performData(
    _ path: String, method: String = "GET", query: [String: String] = [:],
    body: [String: JSONValue]? = nil
  ) async throws -> Data {
    let startGeneration = generation
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
    guard generation == startGeneration else { throw CancellationError() }
    guard let response = response as? HTTPURLResponse else { throw APIError.invalidResponse }
    guard (200..<300).contains(response.statusCode) else {
      if response.statusCode == 401, token != nil {
        try await clearSession()
        throw APIError.unauthenticated
      }
      let message =
        (try? JSONDecoder().decode(ErrorBody.self, from: data).message)
        ?? "Request failed (\(response.statusCode)). Please try again."
      throw APIError.server(response.statusCode, message)
    }
    if let signed = response.value(forHTTPHeaderField: "set-auth-token"), !signed.isEmpty {
      try credentials.write(signed)
      token = signed
    }
    return data
  }
}

private struct ErrorBody: Decodable { let message: String? }

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
