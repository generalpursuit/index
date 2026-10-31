/** Native channels retain their API origin when a canonical custom domain is added. */
export function socketAddress(requestURL: string, account: string, ticket: string) {
  const url = new URL(`/live/${encodeURIComponent(account)}`, requestURL);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.searchParams.set("ticket", ticket);
  return url.href;
}
