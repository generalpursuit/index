import XCTest
import IndexFeatures

final class MessageLinkTests: XCTestCase {
  /// Each link as written in the body, and the address it opens.
  private func links(_ body: String) -> [String] {
    MessageLinks.detect(in: body).map { String(body[$0.range]) }
  }
  private func urls(_ body: String) -> [String] {
    MessageLinks.detect(in: body).map(\.url.absoluteString)
  }

  func testFindsHTTPAndHTTPSAddressesInText() {
    let body = "look https://example.com/a?b=1#c and http://example.org"
    XCTAssertEqual(links(body), ["https://example.com/a?b=1#c", "http://example.org"])
    XCTAssertEqual(urls(body), ["https://example.com/a?b=1#c", "http://example.org"])
  }

  func testAddressesEndAtWhitespaceAndNewlines() {
    XCTAssertEqual(links("https://a.com\nhttps://b.com\thttps://c.com"), ["https://a.com", "https://b.com", "https://c.com"])
    XCTAssertEqual(links("https://a.com,https://b.com"), ["https://a.com,https://b.com"])
  }

  func testWWWOpensOverHTTPS() {
    XCTAssertEqual(links("see www.example.com/x"), ["www.example.com/x"])
    XCTAssertEqual(urls("see www.example.com/x"), ["https://www.example.com/x"])
  }

  func testSchemesAreCaseInsensitive() {
    XCTAssertEqual(links("HTTPS://Example.com/Path Http://a.com WWW.b.com"), ["HTTPS://Example.com/Path", "Http://a.com", "WWW.b.com"])
    XCTAssertEqual(urls("HTTPS://Example.com/Path WWW.b.com"), ["https://Example.com/Path", "https://WWW.b.com"])
  }

  func testLeavesOutBareDomainsAndOtherSchemes() {
    let body = "example.com javascript:alert(1) data:text/html,x file:///etc/hosts mailto:a@b.com tel:+4930123 ftp://a.com +49 30 1234567 tomorrow at 5"
    XCTAssertEqual(links(body), [])
  }

  func testAddressesStartAWord() {
    XCTAssertEqual(links("awww.example.com ahttps://a.com name@www.example.com x_https://a.com"), [])
    XCTAssertEqual(links("a.www.example.com x/https://a.com 1-www.b.com 9https://c.com"), [])
    XCTAssertEqual(links("(https://a.com) \"www.b.com\" ->https://c.com"), ["https://a.com", "www.b.com", "https://c.com"])
    // Scripts written without spaces run straight into an address, as on the web.
    XCTAssertEqual(links("見てhttps://a.com、これもwww.b.com"), ["https://a.com、これもwww.b.com"])
    XCTAssertEqual(links("見てhttps://a.com これもwww.b.com"), ["https://a.com", "www.b.com"])
  }

  func testNeedsAHost() {
    XCTAssertEqual(links("https:// http://. www. www.! https:///path"), [])
  }

  func testLeavesOutTrailingPunctuation() {
    for mark in [".", ",", ";", ":", "!", "?", "'", "\""] {
      XCTAssertEqual(links("go to https://a.com/x\(mark)"), ["https://a.com/x"], mark)
    }
    XCTAssertEqual(links("Really?! https://a.com/x?!..."), ["https://a.com/x"])
    XCTAssertEqual(links("https://a.com/x?q=1"), ["https://a.com/x?q=1"])
  }

  func testKeepsBalancedBracketsAndLeavesOutUnbalancedOnes() {
    XCTAssertEqual(links("https://en.wikipedia.org/wiki/Foo_(bar)"), ["https://en.wikipedia.org/wiki/Foo_(bar)"])
    XCTAssertEqual(links("(see https://a.com)"), ["https://a.com"])
    XCTAssertEqual(links("(see https://en.wikipedia.org/wiki/Foo_(bar))."), ["https://en.wikipedia.org/wiki/Foo_(bar)"])
    XCTAssertEqual(links("[https://a.com/[1]] {https://b.com/{x}}"), ["https://a.com/[1]", "https://b.com/{x}"])
    XCTAssertEqual(links("[https://a.com]"), ["https://a.com"])
  }

  func testLeavesOutAngleBrackets() {
    XCTAssertEqual(links("<https://a.com/x> and <www.b.com>."), ["https://a.com/x", "www.b.com"])
  }

  func testMarkdownStaysLiteral() {
    let body = "[docs](https://a.com/x) *bold* _italic_ # heading"
    XCTAssertEqual(links(body), ["https://a.com/x"])
    XCTAssertEqual(urls(body), ["https://a.com/x"])
  }

  func testRangesStayCorrectAroundUnicodeAndEmoji() {
    let body = "🎉👩‍👩‍👧 Grüße:https://example.com/straße 😀\nnaïve www.例え.jp/ページ 🇩🇪"
    let found = MessageLinks.detect(in: body)
    XCTAssertEqual(found.map { String(body[$0.range]) }, ["https://example.com/straße", "www.例え.jp/ページ"])
    XCTAssertEqual(found.map(\.url.host), ["example.com", "www.xn--r8jz45g.jp"])
    // The ranges convert to UTF-16 offsets, as UIKit and AttributedString count them.
    let first = NSRange(found[0].range, in: body)
    XCTAssertEqual((body as NSString).substring(with: first), "https://example.com/straße")
    let attributed = AttributedString(body)
    XCTAssertEqual(found.compactMap { Range($0.range, in: attributed).map { String(attributed[$0].characters) } }, ["https://example.com/straße", "www.例え.jp/ページ"])
  }

  func testEmojiTouchingAnAddress() {
    XCTAssertEqual(links("🎉https://a.com"), ["https://a.com"])
    // Only whitespace ends an address.
    XCTAssertEqual(links("https://a.com/🎉 next"), ["https://a.com/🎉"])
  }

  func testTrimmingAManyBracketBodyStaysLinear() {
    // The longest body the API accepts. Bubbles detect while rendering, so this must not stall.
    let body = "https://a.com/" + String(repeating: ")", count: 9_980)
    let start = ContinuousClock.now
    XCTAssertEqual(links(body), ["https://a.com/"])
    XCTAssertLessThan(ContinuousClock.now - start, .milliseconds(250))
  }

  func testEmptyAndPlainBodies() {
    XCTAssertEqual(links(""), [])
    XCTAssertEqual(links("no links here, just text."), [])
  }
}
