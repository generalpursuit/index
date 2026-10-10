/** Browser/native URL contract. IDs in API mutations remain internal identifiers. */
export const reservedGroupSlugs = new Set(["all", "favorites", "starred", "settings"]);
export function normalizeGroupName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .trim();
}
/** Deliberately ASCII, without locale-dependent transliteration. */
export function groupSlug(value: string): string {
  return (
    normalizeGroupName(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "group"
  );
}
export const profilePath = (username: string) => `/u/${encodeURIComponent(username)}`;
export const groupPath = (username: string, slug: string) =>
  `${profilePath(username)}/${encodeURIComponent(slug)}`;
export const linkPath = (shortId: string) => `/l/${encodeURIComponent(shortId)}`;
export const conversationPath = (shortId: string) => `/messages/${encodeURIComponent(shortId)}`;
