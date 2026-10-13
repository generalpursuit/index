import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Power, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@index/ui/components/button";
import { IconButton } from "@index/ui/components/icon-button";
import { categoryMarkClassName } from "@/features/links/category-mark";
import { QuickAdd } from "@/features/links/quick-add";
import { weekLinksOptions } from "@/features/links/queries";
import { domain } from "@/features/links/url";
import { More } from "@/components/app/query-state";
import { useAPI } from "@/hooks/use-api";
import { accountGeneration, assertCurrentAccount } from "@/lib/account-boundary";
import { desktopInvoke, isMenuBar } from "@/lib/desktop";
import { measureMenuPanel, openIndex, presentMenuPanel } from "@/lib/desktop/sync";
import { sessionOptions } from "@/lib/session";
import { monday, weekLabel, weekRange } from "@/lib/weeks";
import { client } from "@/utils/orpc";
import type { SavedLink } from "@/lib/types";

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
  const panel = useRef<HTMLElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  useFittedPanel(panel, scroller, content);
  useLayoutEffect(() => {
    // A transparent page lets the window's native glass show through.
    document.documentElement.classList.add("menu-bar-surface");
    return () => document.documentElement.classList.remove("menu-bar-surface");
  }, []);
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
      // A dialog or menu that is animating closed has already handled its own Escape.
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector(
          '[role="dialog"]:not([data-closed]), [role="menu"]:not([data-closed])',
        )
      )
        return;
      report(desktopInvoke("desktop_hide"));
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return (
    <main
      ref={panel}
      className="flex h-dvh min-h-0 flex-col gap-2 rounded-[16px] p-2.5 text-[13px] text-foreground shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.14)] dark:shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.14)]"
      aria-label="Index menu bar"
    >
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div ref={content}>
          {checking || session.isPending ? (
            <p role="status" className="py-8 text-center text-subtle-foreground">
              Checking your session…
            </p>
          ) : session.isError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p role="alert">Could not check your session.</p>
              <Button variant="outline" onClick={() => void session.refetch()}>
                Retry session
              </Button>
            </div>
          ) : !user?.emailVerified ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <h1 className="font-serif text-[21px] leading-[1.15] font-bold tracking-[-0.015em] [font-variation-settings:'opsz'_60]">
                {user ? "Verify your email" : "Your week, close at hand"}
              </h1>
              <p className="max-w-60 text-subtle-foreground">
                {user
                  ? "Finish verification in Index to see and save links."
                  : "Sign in to Index to see and save your links here."}
              </p>
              <Button className="mt-2 px-4" onClick={() => report(openIndex("/login"))}>
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
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-foreground/10 pt-2">
        <Button className="h-8 flex-1 text-[13px]" onClick={() => report(openIndex())}>
          Open Index <ArrowUpRight data-icon="inline-end" className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          className="h-8 bg-foreground/[0.06] px-3 text-[13px] hover:bg-foreground/10 dark:hover:bg-foreground/10"
          onClick={() => report(desktopInvoke("desktop_quit"))}
        >
          <Power data-icon="inline-start" className="size-3.5 text-subtle-foreground" />
          Quit
        </Button>
      </footer>
    </main>
  );
}
// An open menu's offset from its trigger, its border and room from the panel's edge.
const menuMargin = 16;
/**
 * The native panel follows the content's natural height (the window clamps it), grows to show an
 * open menu whole, and opens fully while a dialog sheet is shown.
 */
function useFittedPanel(
  panel: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const measure = () => {
      if (document.querySelector('[role="dialog"]')) return window.screen.availHeight;
      const chrome = panel.current!.offsetHeight - scroller.current!.clientHeight;
      const fitted = chrome + content.current!.getBoundingClientRect().height;
      // Measured from its trigger: until the panel is tall enough, the menu may sit elsewhere.
      const trigger = document.querySelector('[aria-haspopup="menu"][aria-expanded="true"]'),
        menu = document.querySelector('[role="menu"]:not([data-closed])');
      const below =
        trigger && menu ? trigger.getBoundingClientRect().bottom + menu.scrollHeight : 0;
      return Math.ceil(Math.max(fitted, below + menuMargin));
    };
    const stop = measureMenuPanel(measure);
    let frame = 0,
      reported = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = measure();
        if (height === reported) return;
        reported = height;
        void desktopInvoke("desktop_panel_resize", { height }).catch(() => {});
      });
    };
    const sizes = new ResizeObserver(update);
    for (const element of [panel.current!, scroller.current!, content.current!])
      sizes.observe(element);
    // Dialogs are portaled outside the panel.
    const dialogs = new MutationObserver(update);
    dialogs.observe(document.body, { childList: true, subtree: true });
    return () => {
      stop();
      cancelAnimationFrame(frame);
      sizes.disconnect();
      dialogs.disconnect();
    };
  }, [panel, scroller, content]);
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
    <section aria-label="This week's links" className="flex flex-col gap-2">
      <div className="flex items-start justify-between pt-1.5 pr-0.5 pb-1 pl-2">
        <div>
          <h1 className="font-serif text-[23px] leading-[1.05] font-bold tracking-[-0.015em] [font-variation-settings:'opsz'_60]">
            {weekLabel(week)}
          </h1>
          <p className="mt-1.5 font-mono text-[10.5px] leading-none tracking-[0.06em] text-subtle-foreground uppercase">
            {weekRange(week)} · Your links
          </p>
        </div>
        <IconButton
          label="Refresh links"
          className="text-subtle-foreground hover:bg-foreground/[0.06] dark:hover:bg-foreground/[0.06]"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            className={query.isFetching ? "size-3.5 motion-safe:animate-spin" : "size-3.5"}
          />
        </IconButton>
      </div>
      <QuickAdd
        compact
        links={links}
        label="Add a link to this week"
        onViewExisting={(link) => openIndex("/l/" + link.shortId, userId)}
      />
      {query.isPending && (
        <p role="status" className="px-2 py-3 text-subtle-foreground">
          Loading your links…
        </p>
      )}
      {query.isError && (
        <div role="alert" className="px-2 py-3 text-destructive">
          Could not load your links.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry links
          </button>
        </div>
      )}
      {query.isSuccess && !links.length && (
        <p className="py-6 text-center text-subtle-foreground">
          Save your first link for this week.
        </p>
      )}
      {links.length > 0 && (
        <ul>
          {links.map((link) => (
            <li key={link.id}>
              <button
                className="grid h-8.5 w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[7px] pr-2 text-left hover:bg-foreground/[0.06] focus-visible:outline-offset-[-2px]"
                onClick={() => report(openSaved(link))}
                aria-label={`Open ${link.title} in browser`}
              >
                <i
                  className={categoryMarkClassName}
                  data-category={link.category}
                  aria-hidden="true"
                />
                <span className="truncate">{link.title}</span>
                <span className="inline-flex max-w-30 min-w-0 items-center gap-1 text-[11.5px] text-subtle-foreground">
                  <span className="truncate">{domain(link.url)}</span>
                  <ArrowUpRight className="size-3 shrink-0" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <More
        hasNext={query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        fetch={query.fetchNextPage}
      />
    </section>
  );
}
