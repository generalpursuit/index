import { useState } from "react";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import {
  LockKeyhole,
  LockKeyholeOpen,
  Pencil,
  Plus,
  Star,
  EllipsisVertical,
  Trash,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@index/ui/components/dropdown-menu";
import { Confirmation, Modal, IconButton, QueryState } from "@/components/app/primitives";
import { useGroups, useLibraryActions } from "@/features/links/hooks/use-links";
import type { Group } from "@/lib/types";

// Shared by instances in this component; markers remain available to scroll hooks/tests.
const modalActionsClassName =
  "modal-actions flex items-center justify-end gap-2 mt-1 [&_[data-slot='button']]:min-h-9.5 [&_[data-slot='button']]:p-[0_18px] [&_[data-slot='button']]:rounded-full";

/**
 * Your lists in one place: create groups, lock any list (Favorites and Starred too), and
 * rename or delete your own groups. The profile only shows and filters them.
 */
export function GroupSettings({ userId }: { userId: string }) {
  // In the profile's order: Favorites, your groups, then Starred (other people's links).
  const order = { favorites: 0, custom: 1, starred: 2 } as const;
  const groups = useGroups(userId),
    all = (groups.data?.pages.flatMap((p) => p.items) ?? []).sort(
      (a, b) => order[a.kind] - order[b.kind],
    );
  const [creating, setCreating] = useState(false);
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
            Locked lists are only yours, whoever can see your profile.
          </p>
        </div>
        <IconButton label="New group" onClick={() => setCreating(true)}>
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
          {all.map((g) => (
            <li
              key={g.id}
              className={
                "settings-group grid grid-cols-[minmax(0,_1fr)_auto_auto] items-center gap-3.5 min-h-11 [&:hover_.settings-group-actions_[data-slot='button']]:text-muted-foreground"
              }
            >
              <span
                className={"settings-group-name inline-flex items-center gap-2 min-w-0 text-[14px]"}
              >
                {g.kind === "starred" && <Star size={14} aria-hidden="true" />}
                {g.name}
              </span>
              <span
                className={
                  "settings-group-count text-[13px] text-subtle-foreground [font-variant-numeric:tabular-nums]"
                }
              >
                {g.linkCount === 1 ? "1 link" : g.linkCount + " links"}
              </span>
              <GroupActions group={g} />
            </li>
          ))}
        </ul>
      </QueryState>
      {creating && (
        <NewGroup onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />
      )}
    </section>
  );
}
// Lock applies to every list of yours; only your own groups can be renamed or deleted.
function GroupActions({ group }: { group: Group }) {
  const actions = useLibraryActions(),
    [edit, setEdit] = useState(false),
    [name, setName] = useState(group.name),
    [remove, setRemove] = useState(false),
    locked = group.visibility === "private";
  return (
    <div
      className={
        "settings-group-actions flex items-center gap-0.5 mr-[-8px] [&_[data-slot='button']]:text-subtle-foreground [&_[data-slot='button']:hover]:text-foreground"
      }
    >
      <IconButton
        label={locked ? "Unlock " + group.name : "Lock " + group.name}
        disabled={actions.updateGroup.isPending}
        onClick={() =>
          actions.updateGroup.mutate({ id: group.id, visibility: locked ? "public" : "private" })
        }
      >
        {locked ? <LockKeyhole /> : <LockKeyholeOpen />}
      </IconButton>
      {group.kind !== "custom" && <span className={"settings-group-slot w-8"} aria-hidden="true" />}
      {group.kind === "custom" && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label={"Actions for " + group.name} />}
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setName(group.name);
                setEdit(true);
              }}
            >
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setRemove(true)}>
              <Trash />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Modal open={edit} onOpenChange={setEdit} title="Rename group">
        <form
          className={"form-stack flex flex-col gap-4.5"}
          onSubmit={(e) => {
            e.preventDefault();
            actions.updateGroup.mutate({ id: group.id, name }, { onSuccess: () => setEdit(false) });
          }}
        >
          <label className={"modal-field flex flex-col gap-2"}>
            <span
              className={
                "link-form-label font-mono text-[11px] font-normal tracking-[0.06em] uppercase text-subtle-foreground"
              }
            >
              Name
            </span>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className={modalActionsClassName}>
            <Button
              type="button"
              variant="ghost"
              className="modal-cancel"
              onClick={() => setEdit(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || actions.updateGroup.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
      <Confirmation
        open={remove}
        onOpenChange={setRemove}
        title="Delete group?"
        description={
          group.visibility === "private"
            ? "Its links stay on your profile without a group. They will no longer be locked, so anyone who can see your profile will see them."
            : "Its links stay on your profile without a group."
        }
        destructive
        label="Delete group"
        pending={actions.deleteGroup.isPending}
        onConfirm={() =>
          actions.deleteGroup.mutate(
            { id: group.id, deleteLinks: false },
            {
              onSuccess: () => setRemove(false),
            },
          )
        }
      />
    </div>
  );
}
export function NewGroup({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState(""),
    [locked, setLocked] = useState(false),
    actions = useLibraryActions();
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="New group"
    >
      <form
        className={"form-stack flex flex-col gap-4.5"}
        onSubmit={(e) => {
          e.preventDefault();
          actions.createGroup.mutate(
            { name, visibility: locked ? "private" : "public" },
            { onSuccess: (g) => onCreated(g.id) },
          );
        }}
      >
        <label className={"modal-field flex flex-col gap-2"}>
          <span
            className={
              "link-form-label font-mono text-[11px] font-normal tracking-[0.06em] uppercase text-subtle-foreground"
            }
          >
            Name
          </span>
          <Input
            autoFocus
            placeholder="Reading, Wishlist, …"
            maxLength={100}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className={"link-form-group flex flex-col gap-2.5 [&_.muted]:text-[13px]"}>
          <span
            className={
              "link-form-label font-mono text-[11px] font-normal tracking-[0.06em] uppercase text-subtle-foreground"
            }
            id="new-group-visibility"
          >
            Visibility
          </span>
          <div
            className={
              "link-group-choices flex flex-wrap items-center gap-[6px_22px] [&_[role='radio']]:inline-flex [&_[role='radio']]:items-center [&_[role='radio']]:gap-1.5 [&_[role='radio']]:h-8 [&_[role='radio']]:[border-bottom:2px_solid_transparent] [&_[role='radio']]:text-[14px] [&_[role='radio']]:text-subtle-foreground [&_[role='radio']:hover]:text-foreground [&_[aria-checked='true']]:border-b-foreground [&_[aria-checked='true']]:text-foreground"
            }
            role="radiogroup"
            aria-labelledby="new-group-visibility"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!locked}
              onClick={() => setLocked(false)}
            >
              <LockKeyholeOpen size={12} aria-hidden="true" />
              Unlocked
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={locked}
              onClick={() => setLocked(true)}
            >
              <LockKeyhole size={12} aria-hidden="true" />
              Locked
            </button>
          </div>
          <p className={"muted text-subtle-foreground"}>
            {locked
              ? "Only you will see links in this group."
              : "Visible to everyone who can see your profile."}
          </p>
        </div>
        <div className={modalActionsClassName}>
          <Button type="button" variant="ghost" className="modal-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || actions.createGroup.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
