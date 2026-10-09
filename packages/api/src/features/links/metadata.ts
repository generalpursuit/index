import { categorize, categorizePage, isCategorizedSchemaType } from "./categories";
import type { Link } from "./schemas";

/** Performs one HTTP request; injected so tests and local fixtures never touch the network. */
export type FetchPage = (url: string, init: RequestInit) => Promise<Response>;

export type LinkMetadata = {
  title: string;
  siteName: string | null;
  category: Link["category"];
};

const timeoutMs = 4000;
// Some sites (video platforms) put their tags after ~800 KB of inline scripts.
const maxBytes = 1536 * 1024;
const maxRedirects = 3;
const requestHeaders = {
  "user-agent": "Mozilla/5.0 (compatible; IndexBot/1.0)",
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
};

/**
 * Reads the title and category a link should be saved with. It never fails: pages that are
 * unreachable, blocked or not public fall back to what the URL alone says.
 */
export async function readLinkMetadata(url: string, fetchPage: FetchPage): Promise<LinkMetadata> {
  const fallback: LinkMetadata = {
    title: titleFromUrl(url),
    siteName: null,
    category: categorize(url),
  };
  try {
    const response = await fetchPublicPage(url, fetchPage);
    if (!response) return fallback;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html/i.test(contentType)) {
      await response.body?.cancel();
      return {
        ...fallback,
        category: categorizePage(url, { schemaTypes: [], ogType: null, contentType }),
      };
    }
    const head = await parsePage(await readStart(response));
    return {
      title: cleanTitle(head.title, [head.siteName, siteLabel(url)]) ?? fallback.title,
      siteName: head.siteName,
      category: categorizePage(url, { ...head, contentType }),
    };
  } catch {
    return fallback;
  }
}

/** Follows redirects by hand so every hop is checked before it is requested. */
async function fetchPublicPage(url: string, fetchPage: FetchPage) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isPublicWebUrl(current)) return null;
    const response = await fetchPage(current, {
      redirect: "manual",
      signal,
      headers: requestHeaders,
    });
    const location =
      response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return response.ok ? response : null;
    await response.body?.cancel();
    current = new URL(location, current).href;
  }
  return null;
}

/** Only default-port http(s) on public hostnames, so a link can never reach internal services. */
function isPublicWebUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[")) return false;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|arpa)$/.test(host))
    return false;
  if (!host.includes(".")) return false;
  const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ip) return true;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function readStart(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel();
  const bytes = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(bytes);
}

type PageHead = {
  title: string | null;
  siteName: string | null;
  ogType: string | null;
  schemaTypes: string[];
};

async function parsePage(html: string): Promise<PageHead> {
  const meta = new Map<string, string>();
  const scripts: string[] = [];
  let title = "";
  let script = "";
  await new HTMLRewriter()
    .on("meta", {
      element(element) {
        const key = (
          element.getAttribute("property") ?? element.getAttribute("name")
        )?.toLowerCase();
        const content = element.getAttribute("content");
        if (key && content && !meta.has(key)) meta.set(key, decodeEntities(content));
      },
    })
    // Only the document title: icons in the body carry <title> elements too.
    .on("head title", {
      text(chunk) {
        title += chunk.text;
      },
    })
    .on('script[type="application/ld+json"]', {
      text(chunk) {
        script += chunk.text;
        if (chunk.lastInTextNode) {
          scripts.push(script);
          script = "";
        }
      },
    })
    .transform(new Response(html))
    .arrayBuffer();
  const structured = readStructuredData(scripts);
  return {
    title:
      meta.get("og:title") ??
      meta.get("twitter:title") ??
      structured.title ??
      (decodeEntities(title) || null),
    siteName: meta.get("og:site_name") ?? null,
    ogType: meta.get("og:type") ?? null,
    schemaTypes: structured.types,
  };
}

/** Collects schema.org types and a title (a headline, or the name of a categorized thing). */
function readStructuredData(scripts: string[]) {
  const types: string[] = [];
  let headline: string | null = null;
  let name: string | null = null;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const own = [record["@type"]].flat().filter((t): t is string => typeof t === "string");
    types.push(...own);
    if (!headline && typeof record.headline === "string") headline = record.headline;
    if (!name && typeof record.name === "string" && own.some(isCategorizedSchemaType))
      name = record.name;
    visit(record["@graph"]);
  };
  for (const script of scripts) {
    try {
      visit(JSON.parse(script));
    } catch {
      // Broken structured data is common; the other signals still apply.
    }
  }
  return { types, title: headline ?? name };
}

/** Collapses whitespace and drops the site's own name from either end ("GitHub - …", "… | Wikipedia"). */
function cleanTitle(title: string | null, siteNames: (string | null)[]) {
  let clean = title?.replace(/\s+/g, " ").trim() ?? "";
  const names = siteNames.filter((name): name is string => !!name).map(comparable);
  const isSite = (part: string) => names.includes(comparable(part));
  const suffix = clean.match(/^(.*\S)\s+[|·–—-]\s+([^|·–—]+)$/);
  if (suffix && isSite(suffix[2]!)) clean = suffix[1]!;
  const prefix = clean.match(/^([^|·–—:]+?)\s+[|·–—:-]\s+(.*\S)$/);
  if (prefix && isSite(prefix[1]!)) clean = prefix[2]!;
  return clean.slice(0, 500) || null;
}

const comparable = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "en.wikipedia.org" is known as "wikipedia". */
const siteLabel = (url: string) => new URL(url).hostname.split(".").at(-2) ?? null;

/**
 * "…/the-long-read.html" becomes "The long read". Anything that is not a multi-word slug
 * (an ID, a single word like "watch") says little, so the domain stands in.
 */
function titleFromUrl(value: string) {
  const url = new URL(value);
  const segment = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  let words = segment;
  try {
    words = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment if it is not valid percent-encoding.
  }
  words = words
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[-_+]+/g, " ")
    .trim();
  if (!words.includes(" ")) return url.hostname.replace(/^www\./, "");
  return words[0]!.toUpperCase() + words.slice(1);
}

function decodeEntities(text: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const point =
        code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}
