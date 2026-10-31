import { rememberAccount, type AccountSession } from "@/data/account";
import { queryOptions } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { accountGeneration, assertCurrentAccount, clearAccountState } from "./account-boundary";
import { acceptDesktopSession, checkedSessionRevision, revokeDesktopAccess } from "./desktop";
import { authClient } from "./auth-client";
import { queryClient } from "@/utils/orpc";
import { isMessageFileQuery } from "@/features/messages/queries";

export const sessionOptions = queryOptions({
  queryKey: ["session"],
  queryFn: async (): Promise<AccountSession | null> => {
    const generation = accountGeneration();
    const result = await authClient.getSession();
    let nativeRevision = checkedSessionRevision();
    let acceptedGeneration = generation;
    assertCurrentAccount(generation);
    if (result.error) throw new Error(result.error.message || "Could not check your session.");
    const previous = queryClient.getQueryData<{ user: { id: string; emailVerified: boolean } }>([
      "session",
    ]);
    if (
      previous?.user.id === result.data?.user.id &&
      previous?.user.emailVerified &&
      !result.data?.user.emailVerified
    ) {
      await revokeDesktopAccess();
      nativeRevision = checkedSessionRevision();
      assertCurrentAccount(generation);
    }
    if (
      previous &&
      (previous.user.id !== result.data?.user.id ||
        (previous.user.emailVerified && !result.data?.user.emailVerified))
    ) {
      // An expired/replaced cookie in another tab is an account boundary too. Do not
      // cancel this very request: its new identity must still reach its observers.
      const cancelled = clearAccountState(queryClient, true);
      acceptedGeneration = accountGeneration();
      await cancelled;
    }
    assertCurrentAccount(acceptedGeneration);
    acceptDesktopSession(nativeRevision);
    await rememberAccount(
      result.data,
      result.data ? new Date(result.data.session.expiresAt).getTime() : 0,
      nativeRevision >= 0 ? nativeRevision : undefined,
    );
    assertCurrentAccount(acceptedGeneration);
    return result.data ? { user: result.data.user } : null;
  },
  staleTime: 15_000,
  refetchOnWindowFocus: "always",
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
  // File bytes never change, so photos on screen aren't downloaded again.
  await queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== "session" && !isMessageFileQuery(query.queryKey),
  });
}
