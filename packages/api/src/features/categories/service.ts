import type { Link } from "../links/schemas";

export function suggestCategory(url: string): { category: Link["category"]; matched: boolean } {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const domain = (...domains: string[]) =>
    domains.some((value) => host === value || host.endsWith(`.${value}`));
  let category: Link["category"] = "uncategorized";
  if (
    domain("podcasts.apple.com", "pocketcasts.com", "overcast.fm") ||
    (domain("spotify.com") && /^\/(?:intl-[^/]+\/)?(episode|show)\//.test(path))
  )
    category = "podcast";
  else if (
    domain("youtube.com", "youtu.be", "vimeo.com", "twitch.tv") ||
    /\.(mp4|webm|mov)$/.test(path)
  )
    category = "video";
  else if (
    domain("music.apple.com", "soundcloud.com", "bandcamp.com") ||
    (domain("spotify.com") && /^\/(?:intl-[^/]+\/)?(track|album|playlist|artist)\//.test(path)) ||
    /\.(mp3|flac|wav|m4a)$/.test(path)
  )
    category = "music";
  else if (domain("goodreads.com", "openlibrary.org", "books.google.com") || path.endsWith(".epub"))
    category = "book";
  else if (domain("github.com", "gitlab.com", "npmjs.com", "pypi.org")) category = "tool";
  else if (domain("notion.so", "notion.site", "pastebin.com")) category = "note";
  else if (
    domain("medium.com", "substack.com", "wikipedia.org", "arxiv.org") ||
    /^\/(articles?|blog|posts?)\//.test(path)
  )
    category = "article";
  return { category, matched: category !== "uncategorized" };
}
