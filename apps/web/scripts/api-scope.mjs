/** Same conservative namespace as IndexCore.APIScope and the macOS Keychain bridge. */
export function apiScope(raw) {
  if (typeof raw !== "string" || !/^[\x21-\x7e]+$/.test(raw) || raw.includes("\\"))
    throw new Error("Invalid API scope.");
  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(raw);
  if (!match) throw new Error("Invalid API scope.");
  const url = new URL(raw),
    path = match[3] ?? "";
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ||
    (url.port && !(Number(url.port) >= 1 && Number(url.port) <= 65535))
  )
    throw new Error("Invalid API scope.");
  for (const segment of path.split("/")) {
    const value = decodeURIComponent(segment);
    if ([".", ".."].includes(value) || value.includes("/") || value.includes("\\"))
      throw new Error("Invalid API scope.");
  }
  return `${url.protocol}//${url.host}${path.replace(/\/+$/, "")}`;
}
