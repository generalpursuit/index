import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { sessionOptions } from "@/lib/session";
import { apiFor } from "@/utils/orpc";
export function useViewer() {
  return useQuery(sessionOptions).data?.user ?? null;
}
export function useAPI() {
  const viewer = useViewer();
  return useMemo(() => apiFor(viewer?.id ?? null), [viewer?.id]);
}
