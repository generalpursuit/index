/** A notification may only hand a readable in-app path to the server's access-checking resolver. */
export function notificationPath(
  value: { path?: unknown; recipientId?: unknown } | null,
  accountId: string,
) {
  return value?.recipientId === accountId &&
    typeof value.path === "string" &&
    /^\/(messages|l|u)\/[a-zA-Z0-9_-]+$/.test(value.path)
    ? value.path
    : null;
}
