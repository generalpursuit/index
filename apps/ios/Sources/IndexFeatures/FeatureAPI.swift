import Foundation
import IndexCore

/// The existing transport contract, shared by feature models and deterministic tests.
public protocol FeatureAPI: Sendable {
  func request<T: Decodable & Sendable>(
    _ path: String, method: String, query: [String: String], body: [String: JSONValue]?
  ) async throws -> T
  func cached<T: Decodable & Sendable>(_ path: String, query: [String: String]) async -> T?
}
extension APIClient: FeatureAPI {}
extension FeatureAPI {
  func get<T: Decodable & Sendable>(_ path: String, query: [String: String] = [:]) async throws -> T {
    try await request(path, method: "GET", query: query, body: nil)
  }
  func write<T: Decodable & Sendable>(_ path: String, method: String = "POST", body: [String: JSONValue] = [:]) async throws -> T {
    try await request(path, method: method, query: [:], body: body)
  }
}

func removesDisplayedContent(_ error: Error) -> Bool {
  switch error {
  case APIError.unauthenticated, APIError.emailNotVerified: true
  case APIError.server(let status, _): status == 403 || status == 404
  default: false
  }
}

func unique<Item: Identifiable>(_ items: [Item]) -> [Item] {
  var seen = Set<Item.ID>()
  return items.filter { seen.insert($0.id).inserted }
}
