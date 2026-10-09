import type { Link } from "./schemas";

/** Categorizes a link from URL and domain rules alone. */
export function categorize(url: string): Link["category"] {
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
  return category;
}

/** What a fetched page says about itself. */
export type PageSignals = { schemaTypes: string[]; ogType: string | null; contentType: string };

// schema.org types that pages embed as JSON-LD.
const schemaCategories: Record<string, Link["category"]> = {
  VideoObject: "video",
  Movie: "video",
  TVEpisode: "video",
  PodcastEpisode: "podcast",
  PodcastSeries: "podcast",
  MusicRecording: "music",
  MusicAlbum: "music",
  MusicPlaylist: "music",
  Book: "book",
  Article: "article",
  NewsArticle: "article",
  BlogPosting: "article",
  ScholarlyArticle: "article",
  TechArticle: "article",
  Report: "article",
  SoftwareApplication: "tool",
  WebApplication: "tool",
  MobileApplication: "tool",
  SoftwareSourceCode: "tool",
};

/** URL rules are the most precise, so a page's own description only fills their gaps. */
export function categorizePage(url: string, page: PageSignals): Link["category"] {
  const byUrl = categorize(url);
  if (byUrl !== "uncategorized") return byUrl;
  for (const type of page.schemaTypes) {
    const category = schemaCategories[type];
    if (category) return category;
  }
  const ogType = page.ogType?.toLowerCase() ?? "";
  if (ogType.startsWith("video")) return "video";
  if (ogType.startsWith("music")) return "music";
  if (ogType === "article") return "article";
  if (ogType === "book" || ogType.startsWith("books.")) return "book";
  const contentType = page.contentType.toLowerCase();
  if (contentType.startsWith("audio/")) return "music";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.includes("pdf")) return "article";
  return "uncategorized";
}

/** Whether a schema.org type maps to a category, so its name can stand in as a title. */
export const isCategorizedSchemaType = (type: string) => type in schemaCategories;
