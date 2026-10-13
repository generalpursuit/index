import { groupPath, profilePath } from "@index/api/routes";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LockKeyhole, Plus } from "lucide-react";
import { useAllGroups } from "@/features/groups/use-groups";
import { useScrollEdges } from "@/features/links/hooks/use-scroll-edges";

const chipClassName =
  "inline-flex h-7 shrink-0 items-center rounded-full border border-border text-[12.5px] whitespace-nowrap text-foreground hover:bg-muted [&_svg]:shrink-0 [&_svg]:text-subtle-foreground aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground aria-[current=page]:[&_svg]:text-primary-foreground";
// The strip's edge fades, as in its class names.
const fade = 28;

/**
 * Picks which of the person's lists the profile shows: chips in a dock floating at the foot of the
 * screen. Each chip links to its list's address, so the URL stays the source of truth. Starred
 * (other people's links you kept) and a new group are only on your own profile.
 */
export function ListDock({
  userId,
  username,
  own,
  onNewGroup,
}: {
  userId: string;
  username: string;
  own: boolean;
  onNewGroup: (trigger: HTMLButtonElement) => void;
}) {
  const groups = useAllGroups(userId),
    all = groups.data?.pages.flatMap((page) => page.items) ?? [];
  // Favorites first, then the person's groups, like Settings.
  const lists = all
      .filter((group) => group.kind !== "starred")
      .sort((a, b) => Number(b.kind === "favorites") - Number(a.kind === "favorites")),
    starred = all.find((group) => group.kind === "starred");
  const strip = useRef<HTMLDivElement>(null),
    edges = useScrollEdges(strip, lists.length);
  const path = useRouterState({ select: (state) => state.location.pathname });
  // Keeps the chosen list in sight, clear of the fades, without moving a strip that shows it.
  useLayoutEffect(() => {
    const element = strip.current,
      chip = element?.querySelector<HTMLElement>("[aria-current='page']");
    if (!element || !chip) return;
    const start = chip.offsetLeft - fade,
      end = chip.offsetLeft + chip.offsetWidth + fade;
    if (start < element.scrollLeft || end > element.scrollLeft + element.clientWidth)
      element.scrollLeft = chip.offsetLeft - (element.clientWidth - chip.offsetWidth) / 2;
  }, [path, lists.length]);
  if (!lists.length && !own) return null;
  return (
    <>
      {/* Room to scroll the last week clear of the dock. */}
      <div className="h-16" aria-hidden="true" />
      <nav
        aria-label="Lists"
        // Centered on the content column, above the navigation bar along a phone's foot.
        className="list-dock fixed bottom-5 left-[calc(50%_+_50px)] z-10 flex max-w-[min(740px,_calc(100%_-_180px))] -translate-x-1/2 rounded-full bg-card shadow-(--menu-shadow) ring-1 ring-foreground/8 [@media(width<=700px)]:bottom-[calc(78px_+_env(safe-area-inset-bottom))] [@media(width<=700px)]:left-1/2 [@media(width<=700px)]:max-w-[calc(100%_-_32px)]"
      >
        <div
          ref={strip}
          className="relative flex min-w-0 gap-1.5 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&:is([data-fade-start],_[data-fade-end])]:[mask-image:linear-gradient(to_right,_transparent,_#000_var(--fade-start,_0px),_#000_calc(100%_-_var(--fade-end,_0px)),_transparent)] [&[data-fade-start]]:[--fade-start:28px] [&[data-fade-end]]:[--fade-end:28px]"
          data-fade-start={edges.before || undefined}
          data-fade-end={edges.after || undefined}
        >
          <ListChip to={profilePath(username)} userId={userId}>
            All
          </ListChip>
          {lists.map((group) => (
            <ListChip
              key={group.id}
              to={groupPath(username, group.slug)}
              userId={userId}
              groupId={group.id}
            >
              {group.name}
              {group.visibility === "private" && <LockKeyhole aria-hidden="true" />}
            </ListChip>
          ))}
          {own && (
            <>
              <ListChip
                to={groupPath(username, starred?.slug ?? "starred")}
                userId={userId}
                groupId={starred?.id}
              >
                Starred
              </ListChip>
              <button
                type="button"
                aria-label="New group"
                title="New group"
                className={chipClassName + " w-7 justify-center [&_svg]:size-3.5"}
                onClick={(event) => onNewGroup(event.currentTarget)}
              >
                <Plus aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </nav>
    </>
  );
}
/** A link to one list; the router marks it current while its address is open. */
function ListChip({
  to,
  userId,
  groupId,
  children,
}: {
  to: string;
  userId: string;
  groupId?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      state={{ userId, groupId }}
      activeOptions={{ exact: true, includeSearch: false }}
      className={chipClassName + " gap-1 px-3 [&_svg]:size-3"}
    >
      {children}
    </Link>
  );
}
