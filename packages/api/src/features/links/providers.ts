import { decodeEntities } from "./entities";

/** The parts of an oEmbed answer that titles are read from; providers omit what they lack. */
export type OEmbedAnswer = {
  title?: unknown;
  author_name?: unknown;
  author_url?: unknown;
  html?: unknown;
};

/**
 * A site whose pages title its links poorly or are hard to read from a datacenter, but whose
 * oEmbed endpoint answers a small JSON document about the linked thing.
 */
type OEmbedProvider = {
  /** The oEmbed request for a link, or null for links that are left to their page. */
  request(url: URL): string | null;
  /** The link's title, or null when the answer says too little and the page should be read. */
  title(answer: OEmbedAnswer): string | null;
};

/** The provider that titles a link, with its oEmbed request. */
export function findOEmbed(link: string) {
  const url = new URL(link);
  for (const provider of providers) {
    const endpoint = provider.request(url);
    if (endpoint) return { endpoint, title: provider.title };
  }
  return null;
}

// Watch pages ("watch" alone would title them), youtu.be, shorts, streams and playlists.
// Channels and embeds are not embeddable, so their pages are read as before.
const youtube: OEmbedProvider = {
  request(url) {
    const path = url.pathname;
    const known = isHost(url, "youtube.com")
      ? (path === "/watch" && url.searchParams.has("v")) ||
        (path === "/playlist" && url.searchParams.has("list")) ||
        /^\/(shorts|live)\/[\w-]+/.test(path)
      : url.hostname === "youtu.be" && /^\/[\w-]+/.test(path);
    return known
      ? endpoint("https://www.youtube.com/oembed", { url: url.href, format: "json" })
      : null;
  },
  // Streams that are live right now answer without a title.
  title: (answer) => (typeof answer.title === "string" ? answer.title : null),
};

const postLength = 200;

// A post's own title names only its author, so the post's text says what it is. Profiles and
// other pages are read as before.
const x: OEmbedProvider = {
  request(url) {
    const post =
      isHost(url, "x.com", "twitter.com") && /^\/(\w+)\/status\/(\d+)/.exec(url.pathname);
    // Photo and video sub-pages are not embeddable, so the post itself is asked for.
    return post
      ? endpoint("https://publish.x.com/oembed", {
          url: `https://x.com/${post[1]}/status/${post[2]}`,
          omit_script: "1",
        })
      : null;
  },
  title(answer) {
    const author = typeof answer.author_name === "string" ? answer.author_name.trim() : "";
    if (!author) return null;
    const text = postText(typeof answer.html === "string" ? answer.html : "");
    if (text) return `${author}: ${shorten(text, postLength)}`;
    // Only media or links: name the post the way X does.
    const handle = typeof answer.author_url === "string" && /\/(\w+)$/.exec(answer.author_url);
    return handle ? `${author} (@${handle[1]}) on X` : `${author} on X`;
  },
};

const providers = [youtube, x];

/**
 * The text of an embedded post, without its links: X shortens every link and attached
 * media to a t.co address, which says nothing about the post.
 */
function postText(html: string) {
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
  const text = paragraph
    .replace(/<a\b[^>]*\bhref="https?:\/\/t\.co\/[^"]*"[^>]*>[\s\S]*?<\/a>/g, " ")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/** Cuts long text at a word boundary, so a title stays readable at a glance. */
function shorten(text: string, length: number) {
  const characters = [...text];
  if (characters.length <= length) return text;
  const cut = characters.slice(0, length).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const isHost = (url: URL, ...domains: string[]) =>
  domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));

function endpoint(base: string, params: Record<string, string>) {
  return `${base}?${new URLSearchParams(params)}`;
}
