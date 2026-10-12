# Readable routes

Canonical paths are `/u/:username`, `/u/:username/:slug`, `/u/:username/favorites`, `/u/:username/starred`, `/l/:shortId` and `/messages/:shortId`. [Shared builders](../packages/api/src/routes.ts) return relative paths; the client supplies its configured web origin. UUIDs remain API identifiers. Link/conversation short IDs are immutable, permanently reserved, and confer no permissions.

## Reservations and compatibility

Usernames and per-owner group slugs remain reserved after renames and deletion. Alias rows point to the current identity or a deletion tombstone; another identity cannot claim an old URL. An identity can return to its own old name. Database triggers enforce reservations atomically, including Better Auth writes; availability checks are only advisory.

Group names use NFKC normalization and case-insensitive uniqueness. Slugs deliberately use ASCII mapping without locale-dependent transliteration. All, Favorites, Starred and Settings are reserved. JavaScript validation and SQL normalization must stay aligned; the [route tests](../packages/api/src/features/routes) cover Unicode and collision cases. Applied migration SQL also owns legacy repair and reservation triggers; regenerating a schema snapshot cannot replace them.

`GET /api/v1/routes/resolve` accepts a relative path without query/hash and the optional legacy `group` filter. It resolves aliases directly and checks viewer access **before** returning identifiers or a canonical path. Missing and inaccessible destinations are indistinguishable. Private profiles retain discoverable public identity; their content and Starred keep the [API visibility rules](api.md#visibility-and-groups).

Clients replace legacy `/people/:id`, `/links/:id`, UUID conversation URLs and renamed aliases while preserving valid query/hash state. The old group filter becomes a collection path. Post/edit/attachment references use short IDs; inaccessible queued references are dropped without exposing a canonical destination.

## Native reception

[ReadableRoutes.swift](../apps/ios/Sources/IndexCore/ReadableRoutes.swift) accepts `index://` or configured `INDEX_WEB_URL` / `INDEX_WEB_ALIASES` origins. Foreign origins, userinfo, encoded separators and extra path segments are rejected. Credentials never belong in a URL. Universal links additionally need associated-domain entitlements and an AASA file for each deployed domain.

A queued URL is consumed only after successful authorized navigation. Restricted-session continuation and account switches follow [authentication](authentication.md#account-isolation). Use the [iOS checks](../apps/ios/README.md#checks) and web `readable-routes.spec.ts` for aliases, revocation, legacy links and same-account verification resumption.
