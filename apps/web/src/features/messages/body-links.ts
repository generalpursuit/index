/** A piece of a message body: plain text, or a web link written in it. */
export type BodyPart = { text: string; href?: string };

// A link starts with a web scheme or "www." and runs to whitespace or an angle bracket, which
// can't appear in an address and so ends `<https://…>`. Matching can't backtrack.
const candidate = /(?:https?:\/\/|www\.)[^\s<>]*/gi;
// Inside a word or address ("xhttps://", "awww.", "a@www.") nothing starts a link.
const joined = /[\w.@/-]/;
const trailing = new Set([".", ",", ";", ":", "!", "?", "'", '"']);
const openers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Splits a message body into text and the web links written in it, detected as it is shown;
 * nothing is stored. A link's text is exactly what was written. Its trailing punctuation and
 * any closing bracket it didn't open stay text, so "(see https://a.com/x_(y))." links
 * "https://a.com/x_(y)". "www." links open over HTTPS; other schemes and bare domains stay text.
 */
export function bodyParts(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let index = 0;
  for (const match of body.matchAll(candidate)) {
    const start = match.index;
    if (start > 0 && joined.test(body[start - 1]!)) continue;
    const text = withoutTrailing(match[0]),
      href = /^www\./i.test(text) ? "https://" + text : text;
    if (!webAddress(href, text)) continue;
    if (start > index) parts.push({ text: body.slice(index, start) });
    parts.push({ text, href });
    index = start + text.length;
  }
  if (index < body.length) parts.push({ text: body.slice(index) });
  return parts;
}

/** Drops trailing punctuation and unbalanced closing brackets, counting each bracket once. */
function withoutTrailing(text: string) {
  const counts = new Map<string, number>();
  for (const character of text)
    if ("()[]{}".includes(character)) counts.set(character, (counts.get(character) ?? 0) + 1);
  let end = text.length;
  while (end > 0) {
    const last = text[end - 1]!,
      opener = openers[last];
    if (opener) {
      const closes = counts.get(last)!;
      if (closes <= (counts.get(opener) ?? 0)) break;
      counts.set(last, closes - 1);
    } else if (!trailing.has(last)) break;
    end--;
  }
  return text.slice(0, end);
}

/**
 * Whether a link names a host after its prefix that the browser can open. The text must name
 * it: a browser would find one in the path of "https:///x" or "https://\x".
 */
function webAddress(href: string, text: string) {
  if (/^(?:https?:\/\/(?:$|[/\\])|www\.$)/i.test(text)) return false;
  try {
    return !!new URL(href).hostname;
  } catch {
    return false;
  }
}
