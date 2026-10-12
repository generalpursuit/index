import { useEffect, useRef, useState } from "react";
import { Check, Folder, Link, LockKeyhole, Plus, Search } from "lucide-react";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Modal } from "@index/ui/components/modal";
import { More } from "@/components/app/query-state";
import { CreateGroupForm } from "@/features/groups/create-group";
import { useGroups } from "@/features/groups/use-groups";
import { useQuery } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { useViewer } from "@/hooks/use-api";
import type { Group } from "@/lib/types";

import { reconcileGroup } from "@/features/groups/selection";

export function useDestinationStatus(value: Group | null) {
  const viewer = useViewer()!,
    groups = useGroups(viewer.id);
  const items =
    groups.data?.pages.flatMap((page) => page.items).filter((group) => group.kind === "custom") ??
    [];
  return {
    groups,
    items,
    ...reconcileGroup(value, items, groups.complete),
  };
}

/** One owned custom group or Your links. Reusable in quick-add and native desktop windows. */
export function DestinationPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Group | null;
  onChange: (group: Group | null) => void;
  disabled?: boolean;
}) {
  const { groups, items, current, unavailable } = useDestinationStatus(value);
  const profile = useQuery(useAPI().profiles.me.queryOptions());
  const launcher = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false),
    [search, setSearch] = useState("");
  useEffect(() => {
    if (open && search && groups.hasNextPage && !groups.isFetching && !groups.isError)
      void groups.fetchNextPage();
  }, [open, search, groups.hasNextPage, groups.isFetching, groups.isError, groups.fetchNextPage]);
  const close = () => {
    if (!pending) {
      setOpen(false);
      setCreating(false);
      setSearch("");
    }
  };
  const choose = (group: Group | null) => {
    onChange(group);
    close();
  };
  const locked = value
    ? current?.visibility === "private"
    : profile.data?.profileVisibility === "private";
  return (
    <>
      <button
        ref={launcher}
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          void groups.refetch();
        }}
        aria-label={`Save destination: ${unavailable ? "Unavailable group" : (current?.name ?? "Your links")}`}
        className="flex max-w-44 shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-subtle-foreground hover:bg-muted disabled:opacity-50"
      >
        {locked ? <LockKeyhole size={14} /> : value ? <Folder size={14} /> : <Link size={14} />}
        <span className="truncate">
          {unavailable ? "Unavailable group" : (current?.name ?? "Your links")}
        </span>
      </button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={creating ? "Create group" : "Save to"}
        returnFocus={launcher}
      >
        {creating ? (
          <CreateGroupForm
            onClose={() => setCreating(false)}
            onPendingChange={setPending}
            onCreated={(group) => {
              onChange(group);
              setCreating(false);
              setSearch("");
            }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {unavailable && (
              <p role="alert" className="text-sm text-destructive">
                This group is unavailable. Choose a destination before saving.
              </p>
            )}
            <p className="text-sm text-subtle-foreground">
              Choose one destination. Links save into the current week.
            </p>
            <label className="flex items-center gap-2">
              <Search size={16} aria-hidden="true" />
              <Input
                aria-label="Search destinations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="max-h-72 overflow-y-auto" aria-label="Destinations">
              {(!search || "your links".includes(search.toLowerCase())) && (
                <DestinationRow
                  name="Your links"
                  detail="Visible to anyone who can see your profile"
                  locked={profile.data?.profileVisibility === "private"}
                  selected={!value}
                  onClick={() => choose(null)}
                />
              )}
              {items
                .filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
                .map((group) => (
                  <DestinationRow
                    key={group.id}
                    name={group.name}
                    detail={
                      group.visibility === "private"
                        ? "Only you"
                        : "Visible to anyone who can see your profile"
                    }
                    locked={group.visibility === "private"}
                    selected={value?.id === group.id}
                    onClick={() => choose(group)}
                  />
                ))}
              {groups.isPending && <p role="status">Loading groups…</p>}
              {groups.isError && (
                <Button variant="ghost" onClick={() => void groups.refetch()}>
                  Retry loading groups
                </Button>
              )}
              <More
                hasNext={groups.hasNextPage}
                isFetching={groups.isFetchingNextPage}
                fetch={groups.fetchNextPage}
              />
            </div>
            <Button variant="ghost" onClick={() => setCreating(true)}>
              <Plus size={16} />
              Create group
            </Button>
            <Button variant="ghost" onClick={close}>
              Done
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
function DestinationRow({
  name,
  detail,
  locked,
  selected,
  onClick,
}: {
  name: string;
  detail: string;
  locked: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted focus-visible:outline-ring"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        {locked ? (
          <LockKeyhole size={18} aria-label="Locked" />
        ) : (
          <Folder size={18} aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{name}</span>
        <span className="block text-xs text-subtle-foreground">{detail}</span>
      </span>
      {selected && <Check size={18} aria-hidden="true" />}
    </button>
  );
}
