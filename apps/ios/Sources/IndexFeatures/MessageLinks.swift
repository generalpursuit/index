import Foundation

/// A web address written in a message body.
public struct MessageLink: Equatable, Sendable {
  /// Where the address stands in the body, exactly as written.
  public let range: Range<String.Index>
  /// What opening it visits: `www.` addresses open over HTTPS.
  public let url: URL
}

/// Finds the web addresses in a message body when it is shown. Bodies are plain text and stay
/// the only record: nothing is stored, and the text around a link is never interpreted.
/// The rules match the web client's.
public enum MessageLinks {
  /// Addresses start with `http://`, `https://` or `www.`, in any case, and end at whitespace or
  /// an angle bracket. Bare domains and other schemes are not links.
  public static func detect(in body: String) -> [MessageLink] {
    var links: [MessageLink] = []
    var index = body.startIndex
    while index < body.endIndex {
      guard let scheme = scheme(at: index, in: body) else {
        index = body.index(after: index)
        continue
      }
      let end = body[index...].firstIndex(where: endsLink) ?? body.endIndex
      let written = trimmed(body[index..<end])
      if written.count > scheme.prefix.count, let url = url(written, scheme: scheme) {
        links.append(MessageLink(range: written.startIndex..<written.endIndex, url: url))
      }
      index = end
    }
    return links
  }

  private enum Scheme: CaseIterable {
    case http, https, www
    var prefix: String {
      switch self {
      case .http: "http://"
      case .https: "https://"
      case .www: "www."
      }
    }
  }

  /// The scheme of an address starting at `index`. An address does not continue an ASCII word,
  /// address or path, so `awww.`, `name@www.`, `a.www.` and `x/https://` are not links, while
  /// text in a script written without spaces can run straight into one.
  private static func scheme(at index: String.Index, in body: String) -> Scheme? {
    guard "hHwW".contains(body[index]) else { return nil }
    if index > body.startIndex {
      let before = body[body.index(before: index)]
      if before.isASCII && (before.isLetter || before.isNumber || "_.@/-".contains(before)) { return nil }
    }
    let start = body[index...].prefix(Scheme.https.prefix.count).lowercased()
    return Scheme.allCases.first { start.hasPrefix($0.prefix) }
  }

  private static func endsLink(_ character: Character) -> Bool {
    character.isWhitespace || character == "<" || character == ">"
  }

  /// Leaves out sentence punctuation after an address, and closing brackets it did not open,
  /// so `(see https://a.com).` keeps only the address while `…/Foo_(bar)` keeps its `)`.
  private static func trimmed(_ candidate: Substring) -> Substring {
    let openers: [Character] = ["(", "[", "{"], closers: [Character] = [")", "]", "}"]
    // Openers minus closers per kind, counted once and kept current as closers come off the
    // end. The end index walks back rather than `dropLast()`, which counts the whole substring
    // each time, so trimming stays linear.
    var balance = [0, 0, 0]
    for character in candidate {
      if let kind = openers.firstIndex(of: character) {
        balance[kind] += 1
      } else if let kind = closers.firstIndex(of: character) {
        balance[kind] -= 1
      }
    }
    var end = candidate.endIndex
    while end > candidate.startIndex {
      let before = candidate.index(before: end)
      let last = candidate[before]
      if ".,;:!?'\"".contains(last) {
        end = before
      } else if let kind = closers.firstIndex(of: last), balance[kind] < 0 {
        balance[kind] += 1
        end = before
      } else {
        break
      }
    }
    return candidate[..<end]
  }

  private static func url(_ written: Substring, scheme: Scheme) -> URL? {
    let rest = written.dropFirst(scheme.prefix.count)
    // The scheme is lowercased for opening; `www.` keeps its place in the host.
    let address = scheme == .www ? "https://" + written : scheme.prefix + rest
    guard let url = URL(string: address), let host = url.host(percentEncoded: false), !host.isEmpty else { return nil }
    return url
  }
}
