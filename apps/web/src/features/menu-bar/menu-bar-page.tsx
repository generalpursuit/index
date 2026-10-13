import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@index/ui/components/button";
import { categoryMarkClassName } from "@/features/links/category-mark";
import { LinkList, scrollToTop } from "@/features/links/link-list";
import { QuickAdd } from "@/features/links/quick-add";
import { weekLinksOptions } from "@/features/links/queries";
import { domain } from "@/features/links/url";
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
const quit = () => report(desktopInvoke("desktop_quit"));

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
    content = useRef<HTMLDivElement>(null),
    footer = useRef<HTMLElement>(null);
  useFittedPanel(panel, content, footer);
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
    const keys = (event: KeyboardEvent) => {
      // The footer promises Command-Q; Index is not the active app, so its menu may never see it.
      if (event.metaKey && event.key.toLowerCase() === "q") {
        event.preventDefault();
        quit();
      }
      // A dialog that is animating closed has already handled its own Escape.
      else if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"]:not([data-closed])')
      )
        report(desktopInvoke("desktop_hide"));
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);
  return (
    <main
      ref={panel}
      className="flex h-dvh min-h-0 flex-col rounded-[16px] p-2.5 text-[13px] text-foreground shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.14)] dark:shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.14)]"
      aria-label="Index menu bar"
    >
      {/* Takes its natural height; when the panel is shorter, only the link list gives way. */}
      <div ref={content} className="flex min-h-0 flex-col pb-1.5">
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
          <OwnWeek
            key={user.id + ":" + accountGeneration()}
            userId={user.id}
            hidden={checking || session.isPending || session.isError}
          />
        )}
      </div>
      {/* Ends the panel like the items at the end of a native menu. */}
      <footer ref={footer} className="mt-auto shrink-0">
        <hr className="mx-2 border-foreground/10" />
        <div className="pt-1.5">
          <MenuItem
            hint={<ArrowUpRight className="size-3.5" />}
            onClick={() => report(openIndex())}
          >
            Open Index
          </MenuItem>
          <MenuItem hint="⌘Q" shortcut="Meta+Q" onClick={quit}>
            Quit Index
          </MenuItem>
        </div>
      </footer>
    </main>
  );
}
/** A full-width row like a native menu item, with its hint (a shortcut or symbol) at the end. */
function MenuItem({
  hint,
  shortcut,
  onClick,
  children,
}: {
  hint: ReactNode;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="flex h-7 w-full items-center justify-between gap-3 rounded-[6px] px-2 text-left hover:bg-foreground/[0.06] focus-visible:outline-offset-[-2px]"
      aria-keyshortcuts={shortcut}
      onClick={onClick}
    >
      {children}
      <span className="text-subtle-foreground" aria-hidden="true">
        {hint}
      </span>
    </button>
  );
}
/**
 * The native panel follows the content's natural height, showing whole rows of the list when it
 * reaches its maximum, and opens fully while a dialog sheet is shown.
 */
function useFittedPanel(
  panel: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  footer: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const measure = () => {
      if (document.querySelector('[role="dialog"]')) return window.screen.availHeight;
      const page = panel.current!.getBoundingClientRect();
      // A hidden list (while the session is checked) has no offset parent.
      const list = content.current!.querySelector<HTMLElement>(".link-list");
      const shown = list?.offsetParent ? list : null;
      // The footer keeps to the bottom, so leave out any space between it and the content.
      const natural =
        content.current!.getBoundingClientRect().bottom -
        page.top +
        (shown ? shown.scrollHeight - shown.clientHeight : 0) +
        page.bottom -
        footer.current!.getBoundingClientRect().top;
      const max = window.__INDEX_MENU_BAR__!.maxHeight;
      if (!shown || natural <= max) return Math.ceil(natural);
      const row = parseFloat(getComputedStyle(shown).getPropertyValue("--row"));
      const around = natural - shown.scrollHeight;
      return Math.ceil(around + Math.floor((max - around) / row) * row);
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
    for (const element of [panel.current!, content.current!]) sizes.observe(element);
    // Dialogs are portaled outside the panel, and the list's content changes without its size.
    const changes = new MutationObserver(update);
    changes.observe(document.body, { childList: true, subtree: true });
    return () => {
      stop();
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
    };
  }, [panel, content, footer]);
}
function OwnWeek({ userId, hidden }: { userId: string; hidden: boolean }) {
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
  const scroller = useRef<HTMLDivElement>(null);
  return (
    // Kept while hidden, so a draft survives the session check of the next opening.
    <section
      hidden={hidden}
      aria-label="This week's links"
      className="flex min-h-0 flex-col gap-2 [--row:34px]"
    >
      {/* Every opening already refreshes it, and changes elsewhere arrive as they happen. */}
      <div className="pt-1.5 pb-1 pl-2">
        <h1 className="font-serif text-[23px] leading-[1.05] font-bold tracking-[-0.015em] [font-variation-settings:'opsz'_60]">
          {weekLabel(week)}
        </h1>
        <p className="mt-1.5 font-mono text-[10.5px] leading-none tracking-[0.06em] text-subtle-foreground uppercase">
          {weekRange(week)} · Your links
        </p>
      </div>
      <QuickAdd
        compact
        links={links}
        label="Add a link to this week"
        onSave={() => scrollToTop(scroller)}
        onViewExisting={(link) => openIndex("/l/" + link.shortId, userId)}
      />
      <LinkList list={query} label={"Links in " + weekLabel(week)} scroller={scroller}>
        {query.isPending && (
          // Hidden for the first 300ms, so a quick load goes straight to its links.
          <p
            role="status"
            className="px-2 py-3 text-subtle-foreground [animation:loading-reveal_1ms_300ms_backwards]"
          >
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
        {links.map((link) => (
          <MenuLink key={link.id} link={link} />
        ))}
      </LinkList>
    </section>
  );
}
/** Opens the link in the browser; the panel is for glancing at and adding links. */
function MenuLink({ link }: { link: SavedLink }) {
  async function open() {
    const generation = accountGeneration();
    // Access and URL may have changed since the row was loaded.
    const current = await client.links.get({ id: link.id });
    assertCurrentAccount(generation);
    await desktopInvoke("open_website", { url: current.url });
  }
  return (
    <button
      className="grid h-[var(--row)] w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[7px] pr-2 text-left hover:bg-foreground/[0.06] focus-visible:outline-offset-[-2px]"
      onClick={() => report(open())}
      aria-label={`Open ${link.title} in browser`}
    >
      <i className={categoryMarkClassName} data-category={link.category} aria-hidden="true" />
      <span className="truncate">{link.title}</span>
      <span className="inline-flex max-w-30 min-w-0 items-center gap-1 text-[11.5px] text-subtle-foreground">
        <span className="truncate">{domain(link.url)}</span>
        <ArrowUpRight className="size-3 shrink-0" />
      </span>
    </button>
  );
}
