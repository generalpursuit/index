import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAPI } from "@/hooks/use-api";
import { linkReferencePath, isUUID } from "@/lib/routes";
import { LinkDetail } from "@/features/links/link-detail";
import { LinkEditor } from "@/features/links/link-editor";
import { QueryState } from "@/components/app/primitives";
/** Search parameters contain short references; only resolved UUIDs reach data hooks. */
export function LinkReference({
  value,
  mode,
  onDone,
}: {
  value: string;
  mode: "post" | "edit";
  onDone: () => void;
}) {
  const api = useAPI(),
    navigate = useNavigate();
  const resolved = useQuery(
    api.routes.resolve.queryOptions({ input: { path: linkReferencePath(value) }, staleTime: 0 }),
  );
  const target = resolved.data?.kind === "link" ? resolved.data : undefined;
  useEffect(() => {
    if (target && isUUID(value))
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        search: (old) => ({ ...old, [mode]: target.canonicalPath.split("/").pop() }),
      });
  }, [target, value, mode, navigate]);
  return (
    <QueryState
      pending={resolved.isPending}
      hasData={!!target}
      error={resolved.error}
      retry={() => void resolved.refetch()}
    >
      {target &&
        (mode === "post" ? (
          <LinkDetail id={target.linkId} />
        ) : (
          <LinkEditor id={target.linkId} onDone={onDone} />
        ))}
    </QueryState>
  );
}
