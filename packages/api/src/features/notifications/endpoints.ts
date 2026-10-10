/** Explicit push-provider allowlist: user-controlled subscriptions are not arbitrary fetch URLs. */
export function validPushEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.port || u.username || u.password || u.hash) return false;
    return (
      u.hostname === "fcm.googleapis.com" ||
      u.hostname === "updates.push.services.mozilla.com" ||
      u.hostname === "web.push.apple.com" ||
      /^[a-z0-9-]+\.push\.apple\.com$/.test(u.hostname) ||
      u.hostname === "wns2-db5p.notify.windows.com" ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, "0")).join("");
}
