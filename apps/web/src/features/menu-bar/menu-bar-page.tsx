import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@index/ui/components/button";
import { QuickAdd } from "@/features/links/quick-add";
import { weekLinksOptions } from "@/features/links/queries";
import { domain } from "@/features/links/url";
import { More } from "@/components/app/query-state";
import { useAPI } from "@/hooks/use-api";
import { accountGeneration, assertCurrentAccount } from "@/lib/account-boundary";
import { desktopInvoke, isMenuBar } from "@/lib/desktop";
import { openIndex, presentMenuPanel } from "@/lib/desktop/sync";
import { sessionOptions } from "@/lib/session";
import { monday, weekLabel, weekRange } from "@/lib/weeks";
import { client } from "@/utils/orpc";
import type { SavedLink } from "@/lib/types";

type LoginStatus = {
  supported: boolean;
  state: "off" | "enabled" | "requires-approval" | "not-found" | "unsupported";
};
const report = (action: Promise<unknown>) =>
  void action.catch(() => toast.error("Could not complete that. Try again."));

export function MenuBarPage() {
  if (!isMenuBar)
    return <main className="p-6 text-sm">The menu bar is available in Index for macOS.</main>;
  return <MenuPanel />;
}
function MenuPanel() {
  const session = useQuery(sessionOptions);
  const user = session.data?.user;
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const begin = () => setChecking(true),
      end = () => setChecking(false);
    window.addEventListener("index:menu-checking", begin);
    window.addEventListener("index:menu-checked", end);
    return () => {
      window.removeEventListener("index:menu-checking", begin);
      window.removeEventListener("index:menu-checked", end);
    };
  }, []);
  useEffect(() => {
    if (!session.isPending && !checking) void presentMenuPanel(session.isError).catch(() => {});
  }, [session.isPending, session.isError, session.dataUpdatedAt, checking]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"]')
      )
        return;
      report(desktopInvoke("desktop_hide"));
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return (
    <main
      className="flex h-dvh min-h-0 flex-col bg-background text-foreground text-sm"
      aria-label="Index menu bar"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="font-semibold tracking-tight">Index</span>
        <button
          className="rounded-md p-1.5 text-subtle-foreground hover:bg-muted"
          aria-label="Close menu bar"
          onClick={() => report(desktopInvoke("desktop_hide"))}
        >
          <X size={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {checking || session.isPending ? (
          <p role="status">Checking your session…</p>
        ) : session.isError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert">Could not check your session.</p>
            <Button variant="outline" onClick={() => void session.refetch()}>
              Retry session
            </Button>
          </div>
        ) : !user?.emailVerified ? (
          <div className="flex flex-col items-start gap-3 py-8">
            <h1 className="text-xl font-semibold">
              {user ? "Verify your email" : "Your week, close at hand"}
            </h1>
            <p className="text-subtle-foreground">
              {user
                ? "Finish verification in Index to see and save links."
                : "Sign in to Index to see and save your links here."}
            </p>
            <Button onClick={() => report(openIndex("/login"))}>
              {user ? "Verify in Index" : "Sign in to Index"}
            </Button>
          </div>
        ) : null}
        {user?.emailVerified && (
          <div hidden={checking || session.isPending || session.isError}>
            <OwnWeek key={user.id + ":" + accountGeneration()} userId={user.id} />
          </div>
        )}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-border px-4 py-3">
        <LaunchAtLogin />
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => report(openIndex())}>
            Open Index <ArrowUpRight size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => report(desktopInvoke("desktop_quit"))}>
            Quit
          </Button>
        </div>
      </footer>
    </main>
  );
}
function OwnWeek({ userId }: { userId: string }) {
  const api = useAPI();
  const [week, setWeek] = useState(() => monday());
  useEffect(() => {
    const update = () => setWeek(monday());
    // Shared UTC calculation; refresh even if the app stays open across Monday.
    const timer = setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const query = useInfiniteQuery(weekLinksOptions(api, userId, week));
  const links = query.data?.pages.flatMap((page) => page.items) ?? [];
  async function openSaved(link: SavedLink) {
    const generation = accountGeneration();
    // Access and URL may have changed since the row was loaded.
    const current = await client.links.get({ id: link.id });
    assertCurrentAccount(generation);
    await desktopInvoke("open_website", { url: current.url });
  }
  return (
    <section aria-label="This week's links">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{weekLabel(week)}</h1>
          <p className="mt-1 text-xs text-subtle-foreground">{weekRange(week)} · Your links</p>
        </div>
        <button
          aria-label="Refresh links"
          className="rounded-md p-2 text-subtle-foreground hover:bg-muted disabled:opacity-50"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <QuickAdd
        links={links}
        label="Add a link to this week"
        onViewExisting={(link) => openIndex("/l/" + link.shortId, userId)}
      />
      {query.isPending && (
        <p role="status" className="py-4 text-subtle-foreground">
          Loading your links…
        </p>
      )}
      {query.isError && (
        <div role="alert" className="py-3 text-destructive">
          Could not load your links.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry links
          </button>
        </div>
      )}
      {query.isSuccess && !links.length && (
        <p className="py-8 text-center text-subtle-foreground">
          Save your first link for this week.
        </p>
      )}
      <ul className="mt-2 divide-y divide-border">
        {links.map((link) => (
          <li key={link.id}>
            <button
              className="flex w-full items-center gap-3 rounded-lg py-3 text-left hover:bg-muted focus-visible:outline-ring"
              onClick={() => report(openSaved(link))}
              aria-label={`Open ${link.title} in browser`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{link.title}</span>
                <span className="block truncate text-xs text-subtle-foreground">
                  {domain(link.url)}
                </span>
              </span>
              <ArrowUpRight className="shrink-0 text-subtle-foreground" size={15} />
            </button>
          </li>
        ))}
      </ul>
      <More
        hasNext={query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        fetch={query.fetchNextPage}
      />
    </section>
  );
}
function LaunchAtLogin() {
  const [status, setStatus] = useState<LoginStatus | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const read = () =>
      void desktopInvoke<LoginStatus>("launch_at_login_status")
        .then((value) => {
          if (active) {
            setStatus(value);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("Could not read Launch at login.");
        });
    read();
    window.addEventListener("focus", read);
    return () => {
      active = false;
      window.removeEventListener("focus", read);
    };
  }, []);
  const enabled = status?.state === "enabled";
  return (
    <div className="text-xs">
      <label className="flex items-center gap-2 py-1">
        <input
          type="checkbox"
          className="accent-primary"
          checked={enabled}
          disabled={!status?.supported || status.state === "not-found" || pending}
          onChange={async (event) => {
            const next = event.target.checked;
            setPending(true);
            setError("");
            try {
              setStatus(await desktopInvoke<LoginStatus>("launch_at_login_set", { enabled: next }));
            } catch {
              setError("Could not update Launch at login. Check System Settings.");
            } finally {
              setPending(false);
            }
          }}
        />
        Launch at login
      </label>
      {status?.state === "requires-approval" && (
        <div className="text-subtle-foreground">
          Approval needed in System Settings.{" "}
          <button
            className="underline"
            onClick={() => report(desktopInvoke("launch_at_login_settings"))}
          >
            Open Login Items
          </button>
          <button
            className="ml-2 underline"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                setStatus(
                  await desktopInvoke<LoginStatus>("launch_at_login_set", { enabled: false }),
                );
              } catch {
                setError("Could not cancel Launch at login.");
              } finally {
                setPending(false);
              }
            }}
          >
            Cancel request
          </button>
        </div>
      )}
      {status?.state === "not-found" && (
        <p className="text-subtle-foreground">
          Install Index in Applications to use Launch at login.
        </p>
      )}
      {status?.state === "unsupported" && (
        <p className="text-subtle-foreground">Requires an installed macOS 13 or later app.</p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
