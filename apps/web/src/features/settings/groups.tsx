import { useRef, useState, type ReactNode } from "react";
import { Button } from "@index/ui/components/button";
import { Heart, Pencil, Plus, Star, EllipsisVertical, Trash } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@index/ui/components/dropdown-menu";
import { Confirmation } from "@index/ui/components/confirmation";
import { Modal } from "@index/ui/components/modal";
import { QueryState, More } from "@/components/app/query-state";
import { useGroupActions } from "@/features/groups/use-groups";
import { useGroups } from "@/features/groups/use-groups";
import { CreateGroup } from "@/features/groups/create-group";
import { GroupForm, groupSaveError } from "@/features/groups/group-form";
import { GroupLockControl, groupPrivacyDescription } from "@/features/groups/group-lock-control";
import type { Group } from "@/lib/types";
import { SettingsGroup } from "./rows";

/**
 * Your lists in one place, a row each. Favorites and Starred come first and are never locked
 * here: Favorites follows each link's own group, Starred is always private. Your own groups
 * follow, to lock, rename and delete; the last row creates one. The profile only shows and
 * filters them.
 */
export function GroupSettings({ userId }: { userId: string }) {
  const groups = useGroups(userId),
    all = groups.data?.pages.flatMap((p) => p.items) ?? [],
    pinned = (["favorites", "starred"] as const).flatMap((kind) =>
      all.filter((g) => g.kind === kind),
    ),
    own = all.filter((g) => g.kind === "custom");
  const [creating, setCreating] = useState(false);
  const createTrigger = useRef<HTMLButtonElement>(null);
  return (
    <SettingsGroup
      title="Groups"
      className="settings-groups"
      footer="Lock a group to keep its links to yourself. Favorites and Starred are always there."
    >
      <QueryState
        pending={groups.isPending}
        hasData={!!groups.data}
        error={groups.error}
        retry={() => void groups.refetch()}
      >
        <ul className="settings-group-list divide-y divide-border/70">
          {pinned.map((g) => (
            <GroupRow key={g.id} group={g}>
              {/* Keeps counts aligned with the lock and actions of your groups. */}
              <span className="settings-group-slot w-[78px] -mr-2" aria-hidden="true" />
            </GroupRow>
          ))}
          {own.map((g) => (
            <GroupRow key={g.id} group={g}>
              <GroupActions group={g} />
            </GroupRow>
          ))}
        </ul>
        <More
          hasNext={groups.hasNextPage}
          isFetching={groups.isFetchingNextPage}
          fetch={groups.fetchNextPage}
        />
      </QueryState>
      <button
        ref={createTrigger}
        type="button"
        className="settings-new-group flex min-h-11.5 w-full items-center gap-2 rounded-b-2xl px-4 text-left text-[14px] text-foreground hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&_svg]:size-4 [&_svg]:text-subtle-foreground"
        onClick={() => setCreating(true)}
      >
        <Plus aria-hidden="true" />
        New group
      </button>
      {creating && (
        <CreateGroup
          returnFocus={createTrigger}
          onClose={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      )}
    </SettingsGroup>
  );
}
function GroupRow({
  group,
  children,
}: {
  group: Group & { linkCount: number };
  children: ReactNode;
}) {
  return (
    <li
      className={
        "settings-group grid grid-cols-[minmax(0,_1fr)_auto_auto] items-center gap-3.5 min-h-11.5 px-4 [&:hover_.settings-group-actions_[data-slot='button']]:text-muted-foreground"
      }
    >
      <span
        className={
          "settings-group-name inline-flex items-center gap-2 min-w-0 text-[14px] wrap-anywhere"
        }
      >
        {group.kind === "favorites" && <Heart size={14} aria-hidden="true" />}
        {group.kind === "starred" && <Star size={14} aria-hidden="true" />}
        {group.name}
      </span>
      <span
        className={
          "settings-group-count text-[13px] text-subtle-foreground [font-variant-numeric:tabular-nums]"
        }
      >
        {group.linkCount === 1 ? "1 link" : group.linkCount + " links"}
      </span>
      {children}
    </li>
  );
}
// Your own groups can be locked, renamed and deleted.
function GroupActions({ group }: { group: Group }) {
  const actions = useGroupActions(),
    [edit, setEdit] = useState(false),
    [remove, setRemove] = useState(false),
    [privacy, setPrivacy] = useState<boolean>(),
    [error, setError] = useState<string>(),
    locked = group.visibility === "private";
  const submitting = useRef(false);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const busy = actions.updateGroup.isPending || actions.deleteGroup.isPending;
  const changePrivacy = async () => {
    if (submitting.current || privacy === undefined) return;
    submitting.current = true;
    setError(undefined);
    try {
      await actions.updateGroup.mutateAsync({
        id: group.id,
        visibility: privacy ? "private" : "public",
      });
    } catch (cause) {
      setError(groupSaveError(cause));
    } finally {
      submitting.current = false;
      setPrivacy(undefined);
    }
  };
  return (
    <>
      <div className="settings-group-actions flex items-center gap-0.5 -mr-2">
        <GroupLockControl
          name={group.name}
          locked={locked}
          disabled={busy}
          onChange={(next) => {
            setError(undefined);
            setPrivacy(next);
          }}
        />
        <Confirmation
          open={privacy !== undefined}
          onOpenChange={(open) => {
            if (!open && !busy) setPrivacy(undefined);
          }}
          title={privacy ? "Lock group?" : "Unlock group?"}
          description={groupPrivacyDescription(privacy ?? locked)}
          label={privacy ? "Lock group" : "Unlock group"}
          pending={busy}
          onConfirm={() => void changePrivacy()}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={editTrigger}
                variant="ghost"
                size="icon"
                aria-label={"Actions for " + group.name}
              />
            }
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setEdit(true);
              }}
            >
              <Pencil />
              Edit group
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setError(undefined);
                setRemove(true);
              }}
            >
              <Trash />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {edit && (
          <Modal
            open
            onOpenChange={(open) => {
              if (!open && !busy) setEdit(false);
            }}
            title="Edit group"
            returnFocus={editTrigger}
          >
            <GroupForm
              group={group}
              pending={actions.updateGroup.isPending}
              onClose={() => setEdit(false)}
              onSave={async (value) => {
                await actions.updateGroup.mutateAsync({ id: group.id, ...value });
                setEdit(false);
              }}
            />
          </Modal>
        )}
        <Confirmation
          open={remove}
          onOpenChange={(open) => {
            if (!busy) setRemove(open);
          }}
          title="Delete group?"
          description={
            group.visibility === "private"
              ? "Its links stay on your profile without a group. They will no longer be locked, so anyone who can see your profile will see them."
              : "Its links stay on your profile without a group."
          }
          destructive
          label="Delete group"
          returnFocus={editTrigger}
          pending={actions.deleteGroup.isPending}
          onConfirm={async () => {
            if (submitting.current) return;
            submitting.current = true;
            try {
              await actions.deleteGroup.mutateAsync({ id: group.id, deleteLinks: false });
            } catch (cause) {
              setError(groupSaveError(cause));
            } finally {
              submitting.current = false;
              setRemove(false);
            }
          }}
        />
      </div>
      {error && (
        <p className="col-span-3 min-w-0 text-sm text-destructive wrap-anywhere" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
