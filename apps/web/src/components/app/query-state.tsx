import { Button } from "@index/ui/components/button";
import type { ReactNode } from "react";

export function QueryState({
  pending,
  hasData = false,
  error,
  retry,
  placeholder,
  children,
}: {
  pending?: boolean;
  hasData?: boolean;
  error?: Error | null;
  retry?: () => void;
  /** Holds the loaded content's space, where its size is known in advance. */
  placeholder?: ReactNode;
  children?: ReactNode;
}) {
  if (pending && !hasData && placeholder) return placeholder;
  // Hidden for the first 300ms, so a quick load goes straight to its content.
  if (pending && !hasData)
    return (
      <div
        className={
          "loading-state grid gap-4 p-[24px_0] w-full [animation:loading-reveal_1ms_300ms_backwards] [&>div]:h-12 [&>div]:bg-surface [&>div]:rounded-[12px] [&>div]:[animation:loading-pulse_1.5s_ease-in-out_infinite]"
        }
        role="status"
        aria-label="Loading"
      >
        <div />
        <div />
        <div />
      </div>
    );
  if (error && hasData && !("status" in error && [401, 403, 404].includes(Number(error.status))))
    return (
      <>
        {children}
        <p className={"muted text-subtle-foreground"} role="status">
          Couldn’t refresh. Showing saved content.{" "}
          {retry && (
            <button type="button" onClick={retry}>
              Try again
            </button>
          )}
        </p>
      </>
    );
  if (error)
    return (
      <div
        className={
          "empty-state [&[role='alert']>p]:select-text text-muted-foreground p-[32px_12px] text-center [&_p]:mb-3.5 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[4px]"
        }
        role="alert"
      >
        <p>{error.message || "Something went wrong."}</p>
        {retry && (
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    );
  return children;
}
export function More({
  hasNext,
  isFetching,
  fetch,
}: {
  hasNext?: boolean;
  isFetching?: boolean;
  fetch: () => unknown;
}) {
  return hasNext ? (
    <Button
      variant="ghost"
      className={"load-more m-[8px_auto] flex"}
      disabled={isFetching}
      onClick={() => void fetch()}
    >
      {isFetching ? "Loading…" : "Load more"}
    </Button>
  ) : null;
}
