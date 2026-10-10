import Foundation
import Testing
@testable import IndexCore

@Test func canonicalRouteBuilders() {
  #expect(ReadableRoutes.profile("alice") == "/u/alice")
  #expect(ReadableRoutes.group("alice", "read-later") == "/u/alice/read-later")
  #expect(ReadableRoutes.link("abcdefghijklmnop") == "/l/abcdefghijklmnop")
  #expect(ReadableRoutes.conversation("abcdefghijklmnop") == "/messages/abcdefghijklmnop")
  #expect(ReadableRoutes.profile("a/b") == "/u/a%2Fb")
}
@Test func configuredDeepLinkOriginsAndLegacyState() {
  let origins = [URL(string: "https://canonical.example")!, URL(string: "https://alias.example")!]
  for value in ["https://canonical.example/u/alice/reading", "https://alias.example/u/alice/reading", "index://u/alice/reading"] {
    let request = ReadableRouteRequest(url: URL(string: value)!, webOrigins: origins)
    #expect(request?.path == "/u/alice/reading")
  }
  let legacy = ReadableRouteRequest(url: URL(string: "index://people/legacy-id?group=old-group&post=old-link&settings=true")!, webOrigins: origins)
  #expect(legacy?.query["group"] == "old-group")
  #expect(legacy?.query["post"] == "old-link")
  #expect(legacy?.query["settings"] == "true")
  for value in ["https://evil.example/u/alice", "http://canonical.example/u/alice", "https://canonical.example:444/u/alice", "https://user@canonical.example/u/alice", "index://u/alice/reading/extra", "index://u/a%2Fb", "index://u/..", "file:///u/alice"] {
    #expect(ReadableRouteRequest(url: URL(string: value)!, webOrigins: origins) == nil)
  }
}
@Test func routeResolutionDecodesInternalIdentityAfterAccessCheck() throws {
  let data = Data(#"{"kind":"group","userId":"internal-user","groupId":"internal-group","canonicalPath":"/u/alice/reading"}"#.utf8)
  let route = try JSONDecoder().decode(RouteResolution.self, from: data)
  #expect(route.kind == .group)
  #expect(route.groupId == "internal-group")
  #expect(route.canonicalPath == "/u/alice/reading")
}

@Test func sameIdentityBecomingVerifiedCanResumePendingRoute() {
  #expect(!ReadableRouteReadiness.canResolve(userID: nil, emailVerified: false))
  #expect(!ReadableRouteReadiness.canResolve(userID: "same-account", emailVerified: false))
  #expect(ReadableRouteReadiness.canResolve(userID: "same-account", emailVerified: true))
  #expect(!ReadableRouteReadiness.canResolve(userID: "", emailVerified: true))
}
