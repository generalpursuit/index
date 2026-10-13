import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAPI } from "@/hooks/use-api";
import { linkReferencePath, isUUID } from "@/lib/routes";
import { QueryState } from "@/components/app/query-state";
import { linkOptions, loadPost } from "@/features/links/queries";
import type { apiFor } from "@/utils/orpc";
type API = ReturnType<typeof apiFor>;
const referenceOptions = (api: API, value: string) =>
  api.routes.resolve.queryOptions({ input: { path: linkReferencePath(value) } });
/**
 * Loads what a `post` or `edit` reference shows, so its dialog opens complete. Failures are
 * left to the dialog, which shows and retries them.
 */
export async function loadLinkReference(
  cache: QueryClient,
  api: API,
  value: string,
  mode: "post" | "edit",
) {
  try {
    const target = await cache.ensureQueryData(referenceOptions(api, value));
    if (target.kind !== "link") return;
    if (mode === "post") await loadPost(cache, api, target.linkId);
    else await cache.ensureQueryData(linkOptions(api, target.linkId));
  } catch {
    // Shown by the dialog.
  }
}
/** Search parameters contain short references; only resolved UUIDs reach data hooks. */
export function LinkReference({
  value,
  mode,
  children,
}: {
  value: string;
  mode: "post" | "edit";
  children: (linkId: string) => ReactNode;
}) {
  const api = useAPI(),
    navigate = useNavigate();
  const resolved = useQuery({ ...referenceOptions(api, value), staleTime: 0 });
  const target = resolved.data?.kind === "link" ? resolved.data : undefined;
  useEffect(() => {
    if (target && isUUID(value))
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        // Only while the URL still asks for this reference; a closing dialog keeps showing it.
        search: (old) =>
          old[mode] === value ? { ...old, [mode]: target.canonicalPath.split("/").pop() } : old,
      });
  }, [target, value, mode, navigate]);
  return (
    <QueryState
      pending={resolved.isPending}
      hasData={!!target}
      error={resolved.error}
      retry={() => void resolved.refetch()}
    >
      {target && children(target.linkId)}
    </QueryState>
  );
}
