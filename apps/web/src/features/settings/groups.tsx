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
    <section className="settings-box settings-groups" aria-labelledby="settings-groups">
      <div className="settings-groups-heading">
        <div>
          <h2 id="settings-groups">Groups</h2>
          <p className="muted">Locked lists are only yours, whoever can see your profile.</p>
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
            <li key={g.id} className="settings-group">
              <span className="settings-group-name">
                {g.kind === "starred" && <Star size={14} aria-hidden="true" />}
                {g.name}
              </span>
              <span className="settings-group-count">
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
    <div className="settings-group-actions">
      <IconButton
        label={locked ? "Unlock " + group.name : "Lock " + group.name}
        disabled={actions.updateGroup.isPending}
        onClick={() =>
          actions.updateGroup.mutate({ id: group.id, visibility: locked ? "public" : "private" })
        }
      >
        {locked ? <LockKeyhole /> : <LockKeyholeOpen />}
      </IconButton>
      {group.kind !== "custom" && <span className="settings-group-slot" aria-hidden="true" />}
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
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            actions.updateGroup.mutate({ id: group.id, name }, { onSuccess: () => setEdit(false) });
          }}
        >
          <label className="modal-field">
            <span className="link-form-label">Name</span>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="modal-actions">
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
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          actions.createGroup.mutate(
            { name, visibility: locked ? "private" : "public" },
            { onSuccess: (g) => onCreated(g.id) },
          );
        }}
      >
        <label className="modal-field">
          <span className="link-form-label">Name</span>
          <Input
            autoFocus
            placeholder="Reading, Wishlist, …"
            maxLength={100}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="link-form-group">
          <span className="link-form-label" id="new-group-visibility">
            Visibility
          </span>
          <div
            className="link-group-choices"
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
          <p className="muted">
            {locked
              ? "Only you will see links in this group."
              : "Visible to everyone who can see your profile."}
          </p>
        </div>
        <div className="modal-actions">
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
