// Icon Composer exports a 16-bit PNG of the icon shape alone. Write it as an 8-bit sRGB PNG,
// centered on a transparent canvas that carries the destination's padding.
// Arguments: <export> <output> <canvas size>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments.dropFirst()
// With no arguments, only check that the frameworks load.
guard arguments.count == 3 else {
  if arguments.isEmpty { exit(0) }
  fatalError("Expected <export> <output> <canvas size>.")
}
let (input, output) = (arguments[1], arguments[2])
guard let canvas = Int(arguments[3]),
  let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: input) as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
  image.width <= canvas, image.height <= canvas,
  let space = CGColorSpace(name: CGColorSpace.sRGB),
  let context = CGContext(data: nil, width: canvas, height: canvas, bitsPerComponent: 8,
    bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { fatalError("Could not read icon export: \(input)") }
context.draw(image, in: CGRect(x: (canvas - image.width) / 2, y: (canvas - image.height) / 2,
  width: image.width, height: image.height))
guard let result = context.makeImage(),
  let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL,
    UTType.png.identifier as CFString, 1, nil)
else { fatalError("Could not create icon: \(output)") }
CGImageDestinationAddImage(destination, result, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Could not write icon: \(output)") }
