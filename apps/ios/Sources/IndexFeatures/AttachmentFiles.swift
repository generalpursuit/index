import Foundation
import ImageIO
import IndexCore
import UniformTypeIdentifiers

// How picked and pasted bytes become draft files. Images are typed by their bytes, as the
// server types them, and only its inline types show as photos.
extension DraftFile {
  /// Names and types an attachment. It is nil only when the bytes, or every form they could
  /// be sent in, are larger than a message allows, so callers can report the size limit.
  ///
  /// An inline image is a photo whose name ends in its type's extension. With `convert`, other
  /// images become photos too: PNG when they have transparency, so stickers keep it, else JPEG.
  /// Without it, or when conversion fails, they go as they are, as files. Anything else keeps
  /// its name, gaining the declared type's extension when it has none.
  public init?(name: String, data: Data, declared: UTType?, convert: Bool) {
    guard data.count <= MessageLimits.fileBytes else { return nil }
    let source = CGImageSourceCreateWithData(data as CFData, nil)
    let image = source.flatMap { CGImageSourceGetType($0) }.flatMap { UTType($0 as String) }
      .flatMap { $0.conforms(to: .image) ? $0 : nil }
    if let source, let image {
      if Self.shownInline(image) {
        let size = Self.pixelSize(source)
        self.init(name: Self.named(name, as: image), type: image.preferredMIMEType ?? "image/jpeg", data: data,
          width: size?.width, height: size?.height)
        return
      }
      if convert, let photo = Self.converted(source), photo.data.count <= MessageLimits.fileBytes {
        self.init(name: Self.named(name, as: photo.type), type: photo.type.preferredMIMEType ?? "image/jpeg",
          data: photo.data, width: photo.width, height: photo.height)
        return
      }
    }
    let type = image ?? declared
    let named = (name as NSString).pathExtension.isEmpty
      ? name + (type?.preferredFilenameExtension.map { "." + $0 } ?? "") : name
    self.init(name: named, type: type?.preferredMIMEType ?? "application/octet-stream", data: data)
  }

  /// Which of a pasted item's types to read, or nil to leave the item with the text field.
  ///
  /// An image wins even beside text or a link, as an image copied in Safari carries its
  /// address; an inline type comes first. Without an image, an item carrying text, a web link
  /// or rich text (a web archive or RTFD), even alone, stays with the text field. Anything
  /// else is a document. A file link doesn't count as a web link, as a document copied in Files
  /// may carry its own, but it is never the document itself.
  public static func pasteType(among types: [UTType]) -> UTType? {
    if let image = types.first(where: shownInline) ?? types.first(where: { $0.conforms(to: .image) }) {
      return image
    }
    // Rich text formats aren't text types, so they are named.
    let textual = { (type: UTType) in
      type.conforms(to: .text) || [UTType.webArchive, .flatRTFD, .rtfd].contains(where: type.conforms(to:))
        || (type.conforms(to: .url) && !type.conforms(to: .fileURL))
    }
    guard !types.contains(where: textual) else { return nil }
    return types.first { $0.conforms(to: .data) && !$0.conforms(to: .url) }
  }

  static func shownInline(_ type: UTType) -> Bool {
    type.preferredMIMEType.map(MessageLimits.photoTypes.contains) ?? false
  }

  /// `name` ending in `type`'s extension: a matching one stays, another image type's is
  /// replaced, and anything else gains one.
  static func named(_ name: String, as type: UTType) -> String {
    let current = (name as NSString).pathExtension
    let named = current.isEmpty ? nil : UTType(filenameExtension: current)
    if named == type { return name }
    let stem = named?.conforms(to: .image) == true ? (name as NSString).deletingPathExtension : name
    return stem + "." + (type.preferredFilenameExtension ?? "jpeg")
  }

  /// The first image in a type the server shows inline, with its displayed size.
  static func converted(_ source: CGImageSource) -> (data: Data, type: UTType, width: Int, height: Int)? {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { return nil }
    let data = NSMutableData()
    if properties[kCGImagePropertyHasAlpha] as? Bool == true {
      // PNG has no orientation tag to rely on, so the image is drawn upright at full size.
      let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: max(width, height),
      ]
      guard let upright = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
        let destination = CGImageDestinationCreateWithData(data as CFMutableData, UTType.png.identifier as CFString, 1, nil)
      else { return nil }
      CGImageDestinationAddImage(destination, upright, nil)
      guard CGImageDestinationFinalize(destination) else { return nil }
      return (data as Data, .png, upright.width, upright.height)
    }
    // Adding from the source keeps the orientation tag, so the displayed size stays the original's.
    guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImageFromSource(destination, source, 0, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(destination), let size = pixelSize(source) else { return nil }
    return (data as Data, .jpeg, size.width, size.height)
  }

  /// The displayed size: EXIF orientations 5–8 turn the image a quarter.
  static func pixelSize(_ source: CGImageSource) -> (width: Int, height: Int)? {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { return nil }
    let turned = (properties[kCGImagePropertyOrientation] as? Int ?? 1) >= 5
    return turned ? (height, width) : (width, height)
  }
}
