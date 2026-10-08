import { queryOptions } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { authClient } from "./auth-client";
import { queryClient } from "@/utils/orpc";

export const sessionOptions = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    const result = await authClient.getSession();
    if (result.error) throw new Error(result.error.message || "Could not check your session.");
    return result.data;
  },
  staleTime: 15_000,
  refetchInterval: 60_000,
  retry: 1,
});
export async function requireSession({ location }: { location: { href: string } }) {
  const session = await queryClient.fetchQuery(sessionOptions);
  if (!session) throw redirect({ to: "/login", search: { next: location.href } });
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
  await queryClient.cancelQueries();
  queryClient.clear();
  await queryClient.fetchQuery(sessionOptions);
}
