// App Store icons must have no alpha channel, even when every pixel is opaque.
// Flatten generated icon files without changing their size or artwork.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
    let space = CGColorSpace(name: CGColorSpace.sRGB),
    let context = CGContext(data: nil, width: image.width, height: image.height,
      bitsPerComponent: 8, bytesPerRow: 0, space: space,
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
  else { fatalError("Could not read app icon: \(path)") }
  let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
  context.setFillColor(CGColor(gray: 1, alpha: 1))
  context.fill(bounds)
  context.draw(image, in: bounds)
  guard let result = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
  else { fatalError("Could not create app icon: \(path)") }
  CGImageDestinationAddImage(destination, result, nil)
  guard CGImageDestinationFinalize(destination) else { fatalError("Could not write app icon: \(path)") }
}
