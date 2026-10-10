import { queryOptions } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { clearAccountState } from "./account-boundary";
import { authClient } from "./auth-client";
import { queryClient } from "@/utils/orpc";

export const sessionOptions = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    const result = await authClient.getSession();
    if (result.error) throw new Error(result.error.message || "Could not check your session.");
    const previous = queryClient.getQueryData<{ user: { id: string; emailVerified: boolean } }>([
      "session",
    ]);
    if (
      previous &&
      (previous.user.id !== result.data?.user.id ||
        (previous.user.emailVerified && !result.data?.user.emailVerified))
    ) {
      // An expired/replaced cookie in another tab is an account boundary too. Do not
      // cancel this very request: its new identity must still reach its observers.
      await clearAccountState(queryClient, true);
    }
    return result.data;
  },
  staleTime: 15_000,
  refetchInterval: 60_000,
  retry: 1,
});
export async function requireSession({ location }: { location: { href: string } }) {
  const session = queryClient.getQueryData(sessionOptions.queryKey)
    ? await queryClient.ensureQueryData({ ...sessionOptions, revalidateIfStale: true })
    : await queryClient.fetchQuery(sessionOptions);
  if (!session?.user.emailVerified)
    throw redirect({ to: "/login", search: { next: location.href } });
  return { session };
}
export function safeReturn(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.startsWith("/login")
    ? value
    : "/";
}
export async function resetSession() {
  await clearAccountState(queryClient);
  await queryClient.fetchQuery({ ...sessionOptions, staleTime: 0 });
}

/** Refresh the same account after a security change without briefly signing the UI out. */
export async function refreshSession() {
  await queryClient.fetchQuery({ ...sessionOptions, staleTime: 0 });
  await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "session" });
}
