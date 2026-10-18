import Foundation
import ImageIO
import IndexCore
import UniformTypeIdentifiers
import XCTest
@testable import IndexFeatures

final class AttachmentFileTests: XCTestCase {
  func testNamesEndInTheirTypesExtension() {
    XCTAssertEqual(DraftFile.named("photo.JPG", as: .jpeg), "photo.JPG")
    XCTAssertEqual(DraftFile.named("IMG_1.HEIC", as: .jpeg), "IMG_1.jpeg")
    XCTAssertEqual(DraftFile.named("Photo", as: .png), "Photo.png")
    // A dot that starts no image extension stays part of the name.
    XCTAssertEqual(DraftFile.named("Screenshot 2026.10.17", as: .png), "Screenshot 2026.10.17.png")
  }

  func testPasteTakesImagesAndDocumentsButLeavesTextAndLinks() {
    // An image wins beside its address, and an inline type before another image.
    XCTAssertEqual(DraftFile.pasteType(among: [.url, .tiff, .png]), .png)
    XCTAssertEqual(DraftFile.pasteType(among: [.utf8PlainText, .heic]), .heic)
    XCTAssertNil(DraftFile.pasteType(among: [.utf8PlainText]))
    XCTAssertNil(DraftFile.pasteType(among: [.url]))
    XCTAssertNil(DraftFile.pasteType(among: [.webArchive, .utf8PlainText]))
    XCTAssertNil(DraftFile.pasteType(among: [.webArchive]))
    XCTAssertNil(DraftFile.pasteType(among: [.flatRTFD]))
    XCTAssertEqual(DraftFile.pasteType(among: [.fileURL, .pdf]), .pdf)
    XCTAssertNil(DraftFile.pasteType(among: [.fileURL]))
  }

  func testConvertedPhotosKeepTheirDisplayedSize() throws {
    let file = try XCTUnwrap(DraftFile(name: "scan.tiff", data: image(.tiff, orientation: 6), declared: .tiff, convert: true))
    XCTAssertEqual(file.name, "scan.jpeg")
    XCTAssertEqual(file.type, "image/jpeg")
    XCTAssertTrue(file.isPhoto)
    XCTAssertEqual(kind(of: file.data), .jpeg)
    XCTAssertEqual(file.width, 20)
    XCTAssertEqual(file.height, 40)
    // The displayed size holds only while the converted bytes keep the orientation tag.
    XCTAssertEqual(try properties(of: file.data)[kCGImagePropertyOrientation] as? Int, 6)
  }

  func testTransparentPhotosBecomeUprightPNG() throws {
    let file = try XCTUnwrap(
      DraftFile(name: "Sticker", data: image(.tiff, orientation: 6, alpha: true), declared: nil, convert: true))
    XCTAssertEqual(file.name, "Sticker.png")
    XCTAssertEqual(file.type, "image/png")
    XCTAssertEqual(kind(of: file.data), .png)
    XCTAssertEqual(file.width, 20)
    XCTAssertEqual(file.height, 40)
    // Drawn upright, so the stored pixels match the displayed size without an orientation tag.
    let stored = try properties(of: file.data)
    XCTAssertEqual(stored[kCGImagePropertyPixelWidth] as? Int, 20)
    XCTAssertNil(stored[kCGImagePropertyOrientation])
    XCTAssertEqual(stored[kCGImagePropertyHasAlpha] as? Bool, true)
  }

  func testFilesGoAsTheyAreWithoutConversion() throws {
    let tiff = image(.tiff, orientation: 6)
    let file = try XCTUnwrap(DraftFile(name: "scan.tiff", data: tiff, declared: .tiff, convert: false))
    XCTAssertEqual(file.name, "scan.tiff")
    XCTAssertEqual(file.type, "image/tiff")
    XCTAssertEqual(file.data, tiff)
    XCTAssertFalse(file.isPhoto)
    XCTAssertNil(file.width)
  }

  func testInlinePhotosKeepTheirBytesAndTakeTheirExtension() throws {
    let png = image(.png, orientation: 1)
    let file = try XCTUnwrap(DraftFile(name: "wrong.jpg", data: png, declared: .jpeg, convert: true))
    XCTAssertEqual(file.name, "wrong.png")
    XCTAssertEqual(file.type, "image/png")
    XCTAssertEqual(file.data, png)
    XCTAssertEqual(file.width, 40)
    XCTAssertEqual(file.height, 20)
  }

  func testDocumentsKeepTheirNameAndRefuseTheLimit() throws {
    let file = try XCTUnwrap(DraftFile(name: "menu", data: Data("%PDF-1.4".utf8), declared: .pdf, convert: true))
    XCTAssertEqual(file.name, "menu.pdf")
    XCTAssertEqual(file.type, "application/pdf")
    XCTAssertNil(DraftFile(name: "big.bin", data: Data(count: MessageLimits.fileBytes + 1), declared: nil, convert: false))
  }

  func testOneAlertNamesEveryReason() {
    XCTAssertEqual(DraftError.couldNotAttach(tooLarge: false, tooMany: false).errorDescription, "Some files couldn’t be attached.")
    XCTAssertEqual(
      DraftError.couldNotAttach(tooLarge: true, tooMany: true).errorDescription,
      "Some files couldn’t be attached. The limit is 25 MB per file. A message can carry up to 10 files.")
  }

  /// A 40 × 20 red image in `type`, tagged with an EXIF orientation.
  private func image(_ type: UTType, orientation: Int, alpha: Bool = false) -> Data {
    let context = CGContext(
      data: nil, width: 40, height: 20, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: (alpha ? CGImageAlphaInfo.premultipliedLast : .noneSkipLast).rawValue)!
    context.setFillColor(red: 1, green: 0, blue: 0, alpha: alpha ? 0.5 : 1)
    context.fill(CGRect(x: 0, y: 0, width: 40, height: 20))
    let data = NSMutableData()
    let destination = CGImageDestinationCreateWithData(data as CFMutableData, type.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, [kCGImagePropertyOrientation: orientation] as CFDictionary)
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    return data as Data
  }
  private func properties(of data: Data) throws -> [CFString: Any] {
    let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
    return try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
  }
  private func kind(of data: Data) -> UTType? {
    CGImageSourceCreateWithData(data as CFData, nil).flatMap { CGImageSourceGetType($0) }.flatMap { UTType($0 as String) }
  }
}
