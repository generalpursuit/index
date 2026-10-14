import { useRef, type ReactNode } from "react";
import { QueryState } from "@/components/app/query-state";
import { LinkList, scrollToTop } from "./link-list";
import { LinkRow, LinksPlaceholder } from "./link-row";
import { QuickAdd } from "./quick-add";
import { ownerOf, useWeekLinks } from "./hooks/use-links";
import { weekLabel } from "@/lib/weeks";
import type { SavedLink } from "@/lib/types";
export function WeekLinks({
  userId,
  week,
  groupId,
  add = false,
  seed,
  updatedAt,
  showOwners = false,
  lockedGroups,
  placeholder,
}: {
  userId: string;
  week: string;
  groupId?: string;
  add?: boolean;
  seed?: { items: SavedLink[]; nextCursor: string | null };
  updatedAt?: number;
  /** Name whose link each row is, for lists of other people's links. */
  showOwners?: boolean;
  /** Your locked groups; their links show a lock. */
  lockedGroups?: ReadonlySet<string>;
  /** Shown while the links load, sized like them. */
  placeholder?: ReactNode;
}) {
  const list = useWeekLinks(userId, week, groupId, seed, updatedAt);
  const links = list.data?.pages.flatMap((p) => p.items) ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <>
      {/* Outside the scrolling list, so adding stays in reach however long the week gets. */}
      {add && (
        <QuickAdd
          groupId={groupId}
          links={links}
          label={"Enter a link to add it to " + weekLabel(week)}
          onSave={() => scrollToTop(scroller)}
        />
      )}
      {/* Takes the space left under the field; the list inside shows whole rows of it. */}
      <div
        className={"link-area flex-1 min-h-0 [&>.link-list]:max-h-[round(down,_100%,_var(--row))]"}
      >
        <LinkList list={list} label={"Links in " + weekLabel(week)} scroller={scroller}>
          <QueryState
            pending={list.isPending}
            hasData={!!list.data}
            error={list.error}
            retry={() => void list.refetch()}
            placeholder={placeholder ?? <LinksPlaceholder />}
          >
            {links.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                owner={showOwners ? ownerOf(link) : undefined}
                locked={!!link.groupId && !!lockedGroups?.has(link.groupId)}
              />
            ))}
            {list.data?.pages[0]?.items.length === 0 && !add && (
              <p
                className={
                  "empty-state [&[role='alert']>p]:select-text text-muted-foreground p-[32px_12px] text-center [&_p]:mb-3.5 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[4px]"
                }
              >
                No links this week.
              </p>
            )}
          </QueryState>
        </LinkList>
      </div>
    </>
  );
}
