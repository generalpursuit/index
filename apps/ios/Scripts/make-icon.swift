import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

let output = CommandLine.arguments[1]
let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(gray: 0, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
let font = CTFontCreateWithName("Georgia-Bold" as CFString, 760, nil)
let text = NSAttributedString(string: "i", attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font, NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 1, alpha: 1)])
let line = CTLineCreateWithAttributedString(text)
let bounds = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
context.textPosition = CGPoint(x: (1024 - bounds.width) / 2 - bounds.minX, y: (1024 - bounds.height) / 2 - bounds.minY)
CTLineDraw(line, context)
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Could not write icon") }
