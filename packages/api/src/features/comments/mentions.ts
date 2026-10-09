import { usernameSchema } from "@index/auth/username";

/** Match standalone handles, excluding email addresses and URL paths. */
export function mentionedUsernames(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(/(?<![\p{L}\p{N}_@/.:+-])@([a-z0-9_]+)(?![\p{L}\p{N}_])/giu)) {
    const username = usernameSchema.safeParse(match[1]);
    if (username.success) names.add(username.data);
  }
  return [...names];
}
