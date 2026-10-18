import ImageIO
import IndexCore
import IndexFeatures
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#endif

/// What a picker or the pasteboard offered, read up to the draft's free slots.
struct PickedFiles {
  private(set) var files: [DraftFile] = []
  /// Whether some item couldn't be read, or was larger than a message allows.
  var unreadable = false, tooLarge = false
  /// Whether more items were offered than there was room to read.
  let tooMany: Bool
  /// Adds an item read as `data`, or nil when it couldn't be read.
  mutating func add(_ data: Data?, name: String, declared: UTType?, convert: Bool) {
    guard let data else { unreadable = true; return }
    guard let file = DraftFile(name: name, data: data, declared: declared, convert: convert) else { tooLarge = true; return }
    files.append(file)
  }
}

// Loaders run off the main actor and read at most `limit` items, so a large pick never holds
// more files in memory than the draft can take.
extension DraftFile {
  /// Picked photos. The compatible encoding usually turns HEIC into JPEG; screenshots stay PNG
  /// and GIFs stay GIF. Any other image is converted, as a photo is meant to show as one.
  @concurrent static func photos(_ items: [PhotosPickerItem], limit: Int) async -> PickedFiles {
    var picked = PickedFiles(tooMany: items.count > limit)
    for item in items.prefix(limit) {
      picked.add(try? await item.loadTransferable(type: Data.self), name: "Photo", declared: nil, convert: true)
    }
    return picked
  }
  /// Files chosen in the Files app, checked for size before they are read. They go as they
  /// are: an image the server can't show inline, such as a PSD or DNG, stays the original file.
  @concurrent static func files(at urls: [URL], limit: Int) async -> PickedFiles {
    var picked = PickedFiles(tooMany: urls.count > limit)
    for url in urls.prefix(limit) {
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
      let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
      if let size, size > MessageLimits.fileBytes {
        picked.tooLarge = true
        continue
      }
      // A file whose size can't be read can't be read either.
      picked.add(size == nil ? nil : try? Data(contentsOf: url), name: url.lastPathComponent,
        declared: UTType(filenameExtension: url.pathExtension), convert: false)
    }
    return picked
  }
  #if os(iOS)
  /// Photos and documents on the pasteboard, read as `pasteType(among:)` chooses. A pasted
  /// image is converted like a picked photo.
  @concurrent static func pasted(limit: Int) async -> PickedFiles {
    let offered = UIPasteboard.general.itemProviders.compactMap { provider in
      pasteType(among: provider.registeredContentTypes).map { (provider, $0) }
    }
    var picked = PickedFiles(tooMany: offered.count > limit)
    for (provider, type) in offered.prefix(limit) {
      let data: Data? = await withCheckedContinuation { done in
        _ = provider.loadDataRepresentation(for: type) { data, _ in done.resume(returning: data) }
      }
      picked.add(data, name: provider.suggestedName ?? "Pasted", declared: type, convert: true)
    }
    return picked
  }
  #endif
}

/// A downsampled, upright image for display, decoded without holding the full bitmap. The
/// decoding happens here, off the main actor, rather than when the image is first drawn, where
/// it would stall scrolling and typing.
@concurrent func thumbnail(_ data: Data, maxPixels: Int) async -> CGImage? {
  guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
  else { return nil }
  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceShouldCacheImmediately: true,
    kCGImageSourceThumbnailMaxPixelSize: maxPixels,
  ]
  return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
}

/// One draft file inside the composer: its picture or name, upload state and remove button.
struct DraftFileTile: View {
  let file: DraftFile
  /// What VoiceOver calls it, such as "Photo 2 of 3" or the file's name.
  let spokenName: String
  let remove: () -> Void
  @Environment(\.displayScale) private var displayScale
  // Decoded once; the composer redraws on every keystroke.
  @State private var image: CGImage?
  /// Whether a photo's thumbnail is still decoding. One that can't be decoded shows as a file.
  @State private var decoding = true
  private var size: String { ByteCountFormatter.string(fromByteCount: Int64(file.data.count), countStyle: .file) }
  private var status: String? { file.uploaded != nil ? nil : file.failed ? "Couldn’t upload" : "Uploading" }
  /// A photo tile's width: the photo's shape at the tile's height, within bounds.
  private func photoWidth(_ width: Int?, _ height: Int?) -> CGFloat {
    guard let width, let height, height > 0 else { return 96 }
    return min(160, max(64, 96 * CGFloat(width) / CGFloat(height)))
  }
  var body: some View {
    ZStack(alignment: .topTrailing) {
      Group {
        if let image {
          Image(decorative: image, scale: 1).resizable().scaledToFill()
            .frame(width: photoWidth(image.width, image.height), height: 96)
        } else if file.isPhoto && decoding {
          // The photo's own tile, so it neither flashes a file card nor changes size.
          IndexPalette.surface.frame(width: photoWidth(file.width, file.height), height: 96)
        } else {
          VStack(alignment: .leading, spacing: 2) {
            Image(systemName: "doc").foregroundStyle(IndexPalette.subtleForeground)
            Spacer()
            Text(file.name).font(IndexFont.sans(12.5, weight: .medium)).lineLimit(2).truncationMode(.middle)
            Text(size).font(IndexFont.sans(11)).foregroundStyle(IndexPalette.subtleForeground)
          }
          .padding(10).frame(width: 136, height: 96, alignment: .leading)
          .background(IndexPalette.surface)
        }
      }
      .overlay {
        if file.uploaded == nil {
          ZStack {
            Color.black.opacity(0.45)
            if file.failed {
              Image(systemName: "exclamationmark.circle.fill").font(.title2).foregroundStyle(.white)
            } else {
              ProgressView().tint(.white)
            }
          }
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 14))
      .overlay(RoundedRectangle(cornerRadius: 14).stroke(IndexPalette.border))
      // Read as one element, which also leaves out the symbol.
      .accessibilityElement(children: .ignore)
      .accessibilityLabel([spokenName, size, status].compactMap { $0 }.joined(separator: ", "))
      // A filled photo is drawn past the tile's edges; the element stays the tile.
      .contentShape([.interaction, .accessibility], RoundedRectangle(cornerRadius: 14))
      Button(action: remove) {
        // The padding makes the target larger than the small circle.
        Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
          .frame(width: 22, height: 22).background(.black.opacity(0.6), in: Circle())
          .padding(6).contentShape(Rectangle())
      }
      .buttonStyle(.plain).accessibilityLabel("Remove \(spokenName)")
    }
    // At most 160 points wide, the tile's widest.
    .task(id: file.id) {
      if file.isPhoto { image = await thumbnail(file.data, maxPixels: Int(160 * displayScale)) }
      decoding = false
    }
  }
}

/// A message's files above its text: photos as images, anything else as cards. `open` shows
/// one in Quick Look.
struct MessageFilesView: View {
  let message: Message
  let own: Bool
  let highlighted: Bool
  let open: (MessageFile) -> Void
  var body: some View {
    let photos = message.files.filter(\.isPhoto), others = message.files.filter { !$0.isPhoto }
    let several = photos.count > 1, cell: CGFloat = several ? 130 : 240
    VStack(alignment: own ? .trailing : .leading, spacing: 2) {
      if !photos.isEmpty {
        // Flexible columns fit beside an avatar in a group on a small iPhone.
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(maximum: cell), spacing: 3), count: several ? 2 : 1),
          spacing: 3) {
          ForEach(photos) { file in
            MessagePhoto(file: file, conversationID: message.conversationId, width: cell, square: several,
              highlighted: highlighted) { open(file) }
          }
        }
        .frame(maxWidth: several ? 2 * cell + 3 : cell)
      }
      ForEach(others) { file in
        Button { open(file) } label: {
          MessageCard(symbol: "doc", highlighted: highlighted) {
            // Truncated in the middle, so the extension stays visible.
            Text(file.name).font(IndexFont.sans(14, weight: .medium)).lineLimit(2).truncationMode(.middle)
            Text(file.details).font(IndexFont.sans(12)).foregroundStyle(IndexPalette.subtleForeground)
          }
        }
        .buttonStyle(.plain)
      }
    }
  }
}

private struct MessagePhoto: View {
  let file: MessageFile
  let conversationID: String
  /// The widest its grid cell lets it be.
  let width: CGFloat
  /// Whether it shares the grid with other photos, each in a square cell.
  let square: Bool
  let highlighted: Bool
  let open: () -> Void
  @Environment(AccountStore.self) private var store
  @Environment(\.displayScale) private var displayScale
  @State private var image: CGImage?
  private static let maxHeight: CGFloat = 320
  private var ratio: CGFloat { CGFloat(file.width ?? 4) / CGFloat(max(file.height ?? 3, 1)) }
  /// Pixels for the photo's long side as drawn. Filling its tile crops it, so it is drawn longer
  /// than it shows; the cap bounds the decoded bitmap for very long photos.
  private var maxPixels: Int {
    let long = width * (square ? max(ratio, 1 / ratio) : max(1, 1 / ratio))
    return Int((min(long, 1000) * displayScale).rounded(.up))
  }
  /// A lone photo keeps the shape the sender measured, up to a height, so the thread holds still
  /// while it loads. Several fill square cells, cropped, so their rows stay even.
  @ViewBuilder private var tile: some View {
    if square {
      IndexPalette.surface.aspectRatio(1, contentMode: .fit)
    } else {
      IndexPalette.surface.aspectRatio(ratio, contentMode: .fit).frame(maxHeight: Self.maxHeight)
    }
  }
  var body: some View {
    Button(action: open) {
      tile
        .overlay { if let image { Image(decorative: image, scale: 1).resizable().scaledToFill() } }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        // The filled photo is drawn past the tile's edges; only the tile itself opens it.
        .contentShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(IndexPalette.ring, lineWidth: 2).opacity(highlighted ? 1 : 0))
    }
    .buttonStyle(.plain)
    .accessibilityHidden(true)
    // Keyed on verification too: a cached launch can't download until the session is verified.
    .task(id: "\(file.id)-\(store.sessionVerified)") {
      guard image == nil, let data = try? await store.data(for: file, in: conversationID) else { return }
      image = await thumbnail(data, maxPixels: maxPixels)
    }
  }
}
