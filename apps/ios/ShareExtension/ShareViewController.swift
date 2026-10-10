import Foundation
import SwiftUI
import UniformTypeIdentifiers
import IndexCore
import IndexSharing
import IndexUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

#if os(iOS)
typealias SharePlatformController = UIViewController
#else
typealias SharePlatformController = NSViewController
#endif

/// Apple invokes this principal class in its own process, with no WebView or host-app token IPC.
@MainActor @objc(ShareViewController)
final class ShareViewController: SharePlatformController {
  private var model: ShareModel?
  private var inputTask: Task<Void, Never>?
  private var finished = false
  override func loadView() {
    #if os(iOS)
    view = UIView()
    #else
    view = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 580))
    preferredContentSize = NSSize(width: 420, height: 580)
    #endif
    guard let raw = Bundle.main.object(forInfoDictionaryKey: "IndexAPIURL") as? String,
      let scope = try? APIScope.normalize(raw), let server = URL(string: scope),
      let group = Bundle.main.object(forInfoDictionaryKey: "IndexKeychainGroup") as? String,
      !group.isEmpty, !group.contains("$(") else {
      host(AnyView(VStack(spacing: 16) {
        Text("Index sharing needs configuration.")
        Text("Build the app and extension with the same API and shared Keychain group.")
        Button("Cancel") { self.close(cancelled: true) }
      }.padding()))
      return
    }
    let model = ShareModel(server: server, accessGroup: group)
    self.model = model
    model.extracting = true
    host(AnyView(SharePanel(model: model, finish: { self.close(cancelled: false) }, cancel: { self.close(cancelled: true) }).preferredColorScheme(KeychainAppearance(accessGroup: group).read().colorScheme)))
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    inputTask = Task { @MainActor in
      defer { model.extracting = false }
      var addresses: [String] = []
      for provider in providers.prefix(8) {
        let type: String
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) { type = UTType.url.identifier }
        else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) { type = UTType.plainText.identifier }
        else { continue }
        let raw: String? = await withCheckedContinuation { continuation in
          let pending = SharedItemResult(continuation)
          // Host item providers can disappear without calling back. Bound each read and
          // tolerate a callback arriving after cancellation/timeout without double resume.
          DispatchQueue.global().asyncAfter(deadline: .now() + 3) { pending.finish(nil) }
          provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
            let text: String?
            if let url = value as? URL { text = url.absoluteString }
            else if let string = value as? String { text = string }
            else if let data = value as? Data { text = String(data: data, encoding: .utf8) }
            else { text = nil }
            pending.finish(text)
          }
        }
        guard !Task.isCancelled, !finished else { return }
        if let raw, ShareDraft.validURL(raw) != nil {
          let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
          if !addresses.contains(trimmed) { addresses.append(trimmed) }
        }
      }
      guard !Task.isCancelled, !finished else { return }
      if addresses.count == 1 { model.draft.url = addresses[0] }
      else { model.inputIssue = addresses.isEmpty ? "No web link was shared. Enter an HTTP or HTTPS link." : "Share one link at a time, or enter the link you want to save." }
    }
  }
  private func host(_ content: AnyView) {
    #if os(iOS)
    let host = UIHostingController(rootView: content)
    addChild(host); view.addSubview(host.view); host.didMove(toParent: self)
    #else
    let host = NSHostingController(rootView: content)
    addChild(host); view.addSubview(host.view)
    #endif
    host.view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
    ])
  }
  private func close(cancelled: Bool) {
    guard !finished else { return }
    finished = true; inputTask?.cancel(); model?.cancel()
    if cancelled { extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError)) }
    else { extensionContext?.completeRequest(returningItems: nil) }
  }
  #if os(iOS)
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated); inputTask?.cancel(); model?.cancel()
  }
  #else
  override func viewDidDisappear() {
    super.viewDidDisappear(); inputTask?.cancel(); model?.cancel()
  }
  #endif
}

private final class SharedItemResult: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<String?, Never>?
  init(_ continuation: CheckedContinuation<String?, Never>) { self.continuation = continuation }
  func finish(_ value: String?) {
    let pending = lock.withLock {
      let pending = continuation; continuation = nil; return pending
    }
    pending?.resume(returning: value)
  }
}
