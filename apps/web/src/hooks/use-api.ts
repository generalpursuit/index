import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { sessionOptions } from "@/lib/session";
import { apiFor } from "@/utils/orpc";
export function useViewer() {
  const user = useQuery(sessionOptions).data?.user;
  return user?.emailVerified ? user : null;
}
export function useAPI() {
  const viewer = useViewer();
  return useMemo(() => apiFor(viewer?.id ?? null), [viewer?.id]);
}
