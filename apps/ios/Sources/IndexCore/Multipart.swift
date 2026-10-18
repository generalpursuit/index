import Foundation

/// One file sent to the API as multipart form data.
public struct UploadFile: Sendable {
  public let name: String
  public let type: String
  public let data: Data
  public init(name: String, type: String, data: Data) { self.name = name; self.type = type; self.data = data }
}

enum Multipart {
  static func body(file: UploadFile, fields: [String: String], boundary: String) -> Data {
    var body = Data()
    func line(_ text: String = "") { body.append(Data((text + "\r\n").utf8)) }
    for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
      line("--\(boundary)")
      line(#"Content-Disposition: form-data; name="\#(name)""#)
      line()
      line(value)
    }
    line("--\(boundary)")
    line(#"Content-Disposition: form-data; name="file"; filename="\#(quoted(file.name))""#)
    line("Content-Type: \(headerSafe(file.type))")
    line()
    body.append(file.data)
    line()
    line("--\(boundary)--")
    return body
  }
  // A line break would end the header early, so no control character enters one.
  private static func headerSafe(_ text: String) -> String {
    String(text.unicodeScalars.filter { $0.properties.generalCategory != .control })
  }
  // A quote would end the name early, and some parsers let a backslash escape the closing one.
  private static func quoted(_ name: String) -> String {
    headerSafe(name).replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\\", with: "-")
  }
}
