import { Button } from "@index/ui/components/button";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const PendingPageContext = createContext(false);
/** The router has already waited 300 ms before mounting a page's pending component. */
export function PendingPage({ children }: { children: ReactNode }) {
  return <PendingPageContext.Provider value>{children}</PendingPageContext.Provider>;
}
export const usePendingPage = () => useContext(PendingPageContext);

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
  const alreadyWaited = usePendingPage();
  const [held, setHeld] = useState(false);
  const revealed = useRef(0);
  const missing = alreadyWaited || (!!pending && !hasData);
  useEffect(() => {
    if (missing) {
      const timer = setTimeout(
        () => {
          revealed.current = Date.now();
          setHeld(true);
        },
        alreadyWaited ? 0 : 300,
      );
      return () => clearTimeout(timer);
    }
    if (!revealed.current) return;
    const timer = setTimeout(
      () => setHeld(false),
      Math.max(0, 400 - (Date.now() - revealed.current)),
    );
    return () => clearTimeout(timer);
  }, [missing, alreadyWaited]);
  if (missing || held)
    return (
      <div
        className="content-placeholder"
        data-ready={alreadyWaited || undefined}
        data-placeholder={alreadyWaited || undefined}
        role="status"
        aria-label="Loading"
      >
        {placeholder ?? children}
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
