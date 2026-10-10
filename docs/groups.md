# Group creation and management

Groups are personal link collections, separate from conversations. New groups default unlocked. A compact lock button sits next to Name in create/edit forms; its pressed state means locked. The explanation is “Visible to anyone who can see your profile.” or “Only you can see this group and its links.” An unlocked group never overrides a private profile. Starred is always private, including historical public rows, and its lock is disabled with an accessible “Always private” label. Custom groups and Favorites can change privacy; only custom groups can be renamed/deleted.

Web and Tauri share `features/groups/create-group.tsx`:

- `CreateGroup({onClose, onCreated, returnFocus?})` opens the existing responsive Modal (desktop dialog / phone sheet). Mount to open, unmount in `onClose`/`onCreated`. Pass a ref to the initiating button as `returnFocus` when opening without a Base UI trigger. Modal forwards this optional ref to both DialogContent and DrawerContent `finalFocus`.
- `CreateGroupForm({onClose, onCreated})` embeds the same form in a caller-owned save/share surface. The caller owns that surface's focus restoration and pending dismissal policy.
- `onCreated(group: Group): void` receives the full successful server response, including `id`, `name`, `slug`, `visibility` and `ownerId`, once. Assign `group.id` to the saved link's group selection immediately; do not refetch by ID. The profile uses `group.slug` to navigate to the new collection. Cancellation and failures do not call this callback.

Both forms preserve input after validation/request failures, show inline feedback, and prevent concurrent submissions. Standalone modal dismissal is blocked during a write. Existing privacy changes require confirmation; changing a draft lock alone does not write. Names are validated with the API input schema; case-insensitive duplicates, slug collisions and historical reservations remain authoritative server checks and produce inline conflict feedback. No URL preview, custom icon or color control is added. Settings paginates the owner's group list.

Native `GroupEditorView(group: LinkGroup? = nil, onCreated: ((LinkGroup) -> Void)? = nil)` provides the equivalent contract. Present it with `.sheet` and the normal medium/large detents, or as an existing navigation destination. A save/share caller assigns the callback's returned group to its selection; the view dismisses after success. Native Settings manages all groups through the same lock control and editor. Profile creation automatically selects the returned group. `LinkGroup.linkCount` is optional because list responses carry counts while create/get/update responses do not. Native `GroupDraft` mirrors the documented input normalization/length/reserved-name validation; name and slug availability are never inferred from a cached list.

## Integration and verification

Keep Modal's optional `returnFocus` prop when integrating theme primitive changes, and keep `LinkGroup.linkCount` when composing auth/routing model edits. Group UI uses semantic theme tokens and does not own application theme setup or route lifecycle.

Run the disposable browser suite with the assigned ports 3602/4773 using:

```sh
python3 /home/ono/index/.git/t3-feature-rollout/run-browser-tests.py --feature groups -- groups.spec.ts
bun test packages/api/src/features/groups packages/api/src/features/routes packages/api/src/data-access/visibility.test.ts
```

The browser tests cover validation, case-insensitive/slug/history collisions, preserved failed input, pending/double-submit behavior, cancellation and focus restoration, mobile sheet/desktop dialog bounds, create/edit privacy confirmation, Favorites, Starred and profile automatic selection. The API tests cover owner-only writes and private-profile restrictions before/after lock changes. Browser fixtures use a disposable PGlite database; no live accounts or production credentials are needed.

Native source and tests are provided but Swift/Xcode, signing, simulators and devices are unavailable on this Linux VM. On the Mac:

1. Run `cd apps/ios && swift test` (includes `GroupDraftTests`).
2. Start a dedicated disposable fixture API on 3602 and run `INDEX_NATIVE_INTEGRATION=1 INDEX_NATIVE_TEST_PORT=3602 swift test`. Do not run browser tests on that fixture simultaneously. The serialized live suite includes returned-group selection and collision/history recovery.
3. Open `Index.xcodeproj`, build the Index scheme for an iPhone simulator and iPad, then repeat in Light/Dark/System with large Dynamic Type, VoiceOver, keyboard submit, cancellation, nested Settings sheets and gesture dismissal. Verify focus and that one Create action stays reachable above the keyboard; verify no duplicate requests from repeated taps.
4. Exercise Settings create, case-only duplicate, reserved name, long compatibility-normalized name, failed request/retry, edit with privacy-confirmation cancellation, deletion with locked-link warning, Favorites lock/unlock and Starred always private. Verify the profile selects a newly created group and saving a link uses its returned ID.
5. Build/run the Tauri macOS app against a dedicated disposable API and repeat the web group flows in WKWebView, including focus return and both schemes. No native execution or packaging result from earlier work validates these changes.

No domain, email sender, production credential or service deployment is introduced by this feature.
