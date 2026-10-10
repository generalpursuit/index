import Foundation
import Testing
@testable import IndexCore

@Test func groupDraftDefaultsAndInputValidation() {
  var draft = GroupDraft()
  #expect(!draft.locked)
  #expect(draft.visibility == .public)
  #expect(!draft.changesPrivacy)
  #expect(draft.validationError == "Give the group a name.")
  draft.name = " \u{FEFF}Weekend\t  reads \n"
  #expect(draft.normalizedName == "Weekend reads")
  #expect(draft.validationError == nil)
  draft.name = String(repeating: "ﬃ", count: 34)
  #expect(draft.validationError == "Use 100 characters or fewer.")
  draft.name = String(repeating: "😀", count: 50)
  #expect(draft.validationError == nil)
  draft.name += "😀"
  #expect(draft.validationError == "Use 100 characters or fewer.")
  for name in ["ＦＡＶＯＲＩＴＥＳ!", " ALL ", "Starred", "settings"] {
    draft.name = name
    #expect(draft.validationError == "This group name is reserved.")
  }
  // These follow the routing contract's ASCII slug mapping and aren't falsely reserved.
  for name in ["FAVORİTES", "İdea", "\u{0085}", "日本語"] {
    draft.name = name
    #expect(draft.validationError == nil)
  }
  draft.locked = true
  #expect(draft.visibility == .private)
  #expect(GroupDraft.privacyDescription(locked: true) == "Only you can see this group and its links.")
  #expect(GroupDraft.privacyDescription(locked: false) == "Visible to anyone who can see your profile.")
}

@Test func groupEditRequiresPrivacyConfirmationAndProtectsStarred() throws {
  let custom = try JSONDecoder().decode(LinkGroup.self, from: Data(#"{"id":"g","ownerId":"a","name":"Reading","slug":"reading","kind":"custom","visibility":"public","linkCount":3}"#.utf8))
  var draft = GroupDraft(group: custom)
  #expect(custom.linkCount == 3)
  #expect(!draft.changesPrivacy)
  draft.locked = true
  #expect(draft.changesPrivacy)
  draft.locked = false
  #expect(!draft.changesPrivacy)
  // Even a historical public Starred row cannot be unlocked by a client draft.
  let starred = try JSONDecoder().decode(LinkGroup.self, from: Data(#"{"id":"s","ownerId":"a","name":"Starred","kind":"starred","visibility":"public"}"#.utf8))
  var system = GroupDraft(group: starred)
  #expect(system.alwaysPrivate)
  #expect(system.locked)
  system.locked = false
  #expect(system.visibility == .private)
  #expect(system.validationError == nil)
  #expect(system.body["name"] == nil)
  #expect(starred.linkCount == nil)
  #expect(GroupDraft.saveError(APIError.server(409, "conflict")).contains("already reserved"))
}
