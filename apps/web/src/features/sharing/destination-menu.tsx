import { useRef, useState } from "react";
import { ChevronDown, LockKeyhole, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@index/ui/components/dropdown-menu";
import { CreateGroup } from "@/features/groups/create-group";
import { groupLabel } from "@/features/groups/group-lock-control";
import { reconcileGroup } from "@/features/groups/selection";
import { useAllGroups } from "@/features/groups/use-groups";
import { useViewer } from "@/hooks/use-api";
import type { Group } from "@/lib/types";

export type Destination = ReturnType<typeof useDestination>;

/**
 * Where quick-add saves: Your links (`null`) or one of your custom groups. Until you choose, it
 * is the group being viewed, if any. A chosen group follows its current name and visibility.
 * Saving is blocked while that starting group is unknown and once a complete group list shows
 * the destination is gone; it never falls back to Your links by itself.
 */
export function useDestination(initial?: string) {
  const viewer = useViewer()!,
    groups = useAllGroups(viewer.id);
  const items =
    groups.data?.pages.flatMap((page) => page.items).filter((group) => group.kind === "custom") ??
    [];
  // Undefined until you choose.
  const [chosen, setChosen] = useState<Group | null>();
  const starting =
    chosen === undefined && initial ? items.find((group) => group.id === initial) : undefined;
  const waiting = chosen === undefined && !!initial && !starting;
  const { current, unavailable } = reconcileGroup(
    chosen ?? starting ?? null,
    items,
    groups.complete,
  );
  return {
    current,
    unavailable: unavailable || (waiting && groups.complete),
    blocked: unavailable || waiting,
    groups: items,
    loading: groups.isPending,
    failed: groups.isError,
    refresh: () => void groups.refetch(),
    choose: (group: Group | null) => setChosen(group),
  };
}

const itemClassName = "pl-3";

/**
 * The destination as quiet text at the end of an add row, opening a short menu of Your links and
 * your groups. New group creates one and selects it.
 */
export function DestinationMenu({
  destination,
  disabled = false,
}: {
  destination: Destination;
  disabled?: boolean;
}) {
  const { current, unavailable, groups, choose } = destination;
  const trigger = useRef<HTMLButtonElement>(null);
  const [creating, setCreating] = useState(false);
  const name = unavailable ? "Unavailable group" : (current?.name ?? "Your links"),
    locked = !unavailable && current?.visibility === "private";
  const label = unavailable || !current ? name : groupLabel(current);
  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          // Shows renamed, locked and deleted groups as they are now.
          if (open) destination.refresh();
        }}
      >
        <DropdownMenuTrigger
          ref={trigger}
          disabled={disabled}
          aria-label={"Save destination: " + label}
          className="destination-menu relative flex max-w-44 min-w-0 shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] text-subtle-foreground after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-50 aria-expanded:bg-muted aria-expanded:text-foreground [&_svg]:size-3 [&_svg]:shrink-0 [&>svg:last-child]:[transition:transform_150ms_ease] [&[aria-expanded='true']>svg:last-child]:[transform:rotate(180deg)]"
        >
          <span className="truncate">{name}</span>
          {locked && <LockKeyhole aria-hidden="true" />}
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            // Nothing is checked while the chosen group is unavailable.
            value={unavailable ? null : (current?.id ?? "")}
            onValueChange={(id) => choose(groups.find((group) => group.id === id) ?? null)}
          >
            <DropdownMenuRadioItem value="" closeOnClick className={itemClassName}>
              Your links
            </DropdownMenuRadioItem>
            {groups.map((group) => (
              <DropdownMenuRadioItem
                key={group.id}
                value={group.id}
                closeOnClick
                className={itemClassName}
                aria-label={groupLabel(group)}
              >
                <span className="flex min-w-0 items-center gap-1.5 [&_svg]:size-3 [&_svg]:text-subtle-foreground">
                  <span className="truncate">{group.name}</span>
                  {group.visibility === "private" && <LockKeyhole aria-hidden="true" />}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {destination.loading && (
            <p role="status" className="px-3 py-2 text-[13px]">
              Loading groups…
            </p>
          )}
          {destination.failed && (
            <DropdownMenuItem
              closeOnClick={false}
              className={itemClassName}
              onClick={destination.refresh}
            >
              Retry loading groups
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-1.5 pl-3 [&>svg]:static"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" />
            New group…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {creating && (
        <CreateGroup
          returnFocus={trigger}
          onClose={() => setCreating(false)}
          onCreated={(group) => {
            choose(group);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
