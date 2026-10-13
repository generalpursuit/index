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
import { IconButton } from "@index/ui/components/icon-button";
import { QueryState, More } from "@/components/app/query-state";
import { useGroupActions } from "@/features/groups/use-groups";
import { useGroups } from "@/features/groups/use-groups";
import { CreateGroup } from "@/features/groups/create-group";
import { GroupForm, groupSaveError } from "@/features/groups/group-form";
import { GroupLockControl, groupPrivacyDescription } from "@/features/groups/group-lock-control";
import type { Group } from "@/lib/types";

/**
 * Your lists in one place. Favorites and Starred come first and are never locked here: Favorites
 * follows each link's own group, Starred is always private. Below them you create, lock, rename
 * and delete your own groups. The profile only shows and filters them.
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
    <section
      className={
        "settings-box p-[20px_22px] border border-border rounded-[18px] [&_h2]:text-[16px] [&_h2]:font-medium [&_h2+p]:mt-1 [&_h2+p]:text-[13px] settings-groups"
      }
      aria-labelledby="settings-groups"
    >
      <div
        className={
          "settings-groups-heading flex items-start justify-between gap-4 mb-2.5 [&_[data-slot='button']]:flex-none [&_[data-slot='button']]:m-[-4px_-8px_0_0] [&_[data-slot='button']]:text-subtle-foreground [&_[data-slot='button']:hover]:text-foreground"
        }
      >
        <div>
          <h2 id="settings-groups">Groups</h2>
          <p className={"muted text-subtle-foreground"}>
            Lock a group to keep its links to yourself.
          </p>
        </div>
        <IconButton ref={createTrigger} label="New group" onClick={() => setCreating(true)}>
          <Plus />
        </IconButton>
      </div>
      <QueryState
        pending={groups.isPending}
        hasData={!!groups.data}
        error={groups.error}
        retry={() => void groups.refetch()}
      >
        <ul className="settings-group-list">
          {pinned.map((g) => (
            <GroupRow key={g.id} group={g}>
              {/* Keeps counts aligned with the lock and actions of your groups. */}
              <span className="settings-group-slot w-[78px] -mr-2" aria-hidden="true" />
            </GroupRow>
          ))}
        </ul>
        {own.length > 0 && (
          <>
            <h3
              id="settings-own-groups"
              className={
                "settings-group-divider flex items-center gap-2.5 mt-2 mb-1 font-mono text-[11px] font-normal uppercase tracking-[0.06em] text-subtle-foreground after:flex-1 after:h-px after:bg-border after:content-['']"
              }
            >
              Your groups
            </h3>
            <ul className="settings-group-list" aria-labelledby="settings-own-groups">
              {own.map((g) => (
                <GroupRow key={g.id} group={g}>
                  <GroupActions group={g} />
                </GroupRow>
              ))}
            </ul>
          </>
        )}
        <More
          hasNext={groups.hasNextPage}
          isFetching={groups.isFetchingNextPage}
          fetch={groups.fetchNextPage}
        />
      </QueryState>
      {creating && (
        <CreateGroup
          returnFocus={createTrigger}
          onClose={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      )}
    </section>
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
        "settings-group grid grid-cols-[minmax(0,_1fr)_auto_auto] items-center gap-3.5 min-h-11 [&:hover_.settings-group-actions_[data-slot='button']]:text-muted-foreground"
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
