import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import {
  LockKeyhole,
  LockKeyholeOpen,
  Earth,
  Pencil,
  Plus,
  Star,
  Settings,
  EllipsisVertical,
  Trash,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@index/ui/components/dropdown-menu";
import {
  Back,
  Confirmation,
  UserAvatar,
  QueryState,
  Modal,
  More,
  IconButton,
} from "@/components/app/primitives";
import { useViewer } from "@/hooks/use-api";
import { useProfile, useProfileActions } from "./hooks/use-profiles";
import { useGroups, useLibraryWeeks, useLibraryActions } from "@/features/links/hooks/use-links";
import { WeekLinks } from "@/features/feed/feed-page";
import { monday, weekLabel, weekRange } from "@/lib/weeks";
import { Connections } from "./connections";
import type { Profile, Person, Group } from "@/lib/types";
const count = (n: number, noun: string) => n + " " + noun + (n === 1 ? "" : "s");
export function FollowButton({ person }: { person: Person }) {
  const viewer = useViewer(),
    profile = useProfile(person.id),
    actions = useProfileActions();
  if (viewer?.id === person.id) return null;
  if (!viewer)
    return (
      <Link className="pill" to="/login">
        Sign in to follow
      </Link>
    );
  const status = profile.data?.followingStatus;
  return (
    <Button
      variant="outline"
      disabled={profile.isPending || actions.follow.isPending || actions.unfollow.isPending}
      onClick={() =>
        status
          ? actions.unfollow.mutate({ userId: person.id })
          : actions.follow.mutate({ userId: person.id })
      }
    >
      {status === "accepted"
        ? "Following"
        : status === "pending"
          ? "Requested"
          : person.profileVisibility === "private"
            ? "Request"
            : "Follow"}
    </Button>
  );
}
export function ProfilePage({ userId, group = "all" }: { userId: string; group?: string }) {
  const profile = useProfile(userId);
  return (
    <QueryState
      pending={profile.isPending}
      error={profile.error}
      retry={() => void profile.refetch()}
    >
      {profile.data && <ProfileContent key={userId} profile={profile.data} filter={group} />}
    </QueryState>
  );
}
function ProfileContent({ profile, filter }: { profile: Profile; filter: string }) {
  const viewer = useViewer(),
    own = viewer?.id === profile.id,
    navigate = useNavigate();
  const [connections, setConnections] = useState<"followers" | "following" | null>(null),
    [newGroup, setNewGroup] = useState(false);
  const groups = useGroups(profile.id),
    allGroups = groups.data?.pages.flatMap((p) => p.items) ?? [],
    selected = allGroups.find((g) => g.id === filter),
    starredGroup = allGroups.find((g) => g.kind === "starred"),
    // Starred holds other people's links, so it sits apart from the filters for your own.
    starredTab = filter === "starred" || selected?.kind === "starred",
    select = (group?: string) => void navigate({ to: ".", search: (old) => ({ ...old, group }) });
  const hidden = !profile.canViewContent;
  return (
    <div className="profile-page">
      {!own && <Back fallback="/discover" />}
      <header className="profile-heading">
        <UserAvatar person={profile} large />
        <div className="profile-identity">
          <div className="profile-name">
            <h1>{profile.username ?? profile.name}</h1>
            <span
              className="profile-visibility"
              role="img"
              aria-label={
                profile.profileVisibility === "private" ? "Private profile" : "Public profile"
              }
              title={profile.profileVisibility === "private" ? "Private profile" : "Public profile"}
            >
              {profile.profileVisibility === "private" ? (
                <LockKeyhole size={16} aria-hidden="true" />
              ) : (
                <Earth size={16} aria-hidden="true" />
              )}
            </span>
          </div>
          <p className="profile-meta">
            <span>{profile.name}</span>
            {profile.linkCount !== null && <span>{count(profile.linkCount, "link")}</span>}
            {own && (
              <>
                <button type="button" onClick={() => setConnections("followers")}>
                  {count(profile.followerCount ?? 0, "follower")}
                </button>
                <button type="button" onClick={() => setConnections("following")}>
                  {profile.followingCount ?? 0} following
                </button>
              </>
            )}
          </p>
        </div>
        <div className="heading-actions">
          {own ? (
            <Link to="/settings" className="icon-link" aria-label="Settings" title="Settings">
              <Settings />
            </Link>
          ) : (
            !hidden && <FollowButton person={profile} />
          )}
        </div>
      </header>
      {!own && profile.followedBy.total > 0 && (
        <p className="muted social-context">
          Followed by{" "}
          {profile.followedBy.users.slice(0, profile.followedBy.total > 2 ? 1 : 2).map((p, i) => (
            <span key={p.id}>
              {i > 0 ? " and " : ""}
              <Link to="/people/$userId" params={{ userId: p.id }}>
                {p.username ?? p.name}
              </Link>
            </span>
          ))}
          {profile.followedBy.total > 2 ? " and " + (profile.followedBy.total - 1) + " others" : ""}
        </p>
      )}
      {hidden ? (
        <div className="private-profile">
          <LockKeyhole size={32} />
          <h2>Private profile</h2>
          <p className="muted">Only {profile.name}’s followers can view their posts.</p>
          <FollowButton person={profile} />
        </div>
      ) : (
        <>
          <nav className="profile-filters" aria-label="Links">
            <div className="profile-groups">
              <button
                type="button"
                aria-pressed={filter === "all"}
                onClick={() => select(undefined)}
              >
                All
              </button>
              {allGroups
                .filter((g) => g.kind !== "starred")
                .map((g) => (
                  <button
                    type="button"
                    key={g.id}
                    aria-pressed={filter === g.id}
                    onClick={() => select(g.id)}
                  >
                    {g.visibility === "private" && <LockKeyhole size={12} aria-hidden="true" />}
                    {g.name}
                  </button>
                ))}
              <More
                hasNext={groups.hasNextPage}
                isFetching={groups.isFetchingNextPage}
                fetch={groups.fetchNextPage}
              />
              {own && (
                <IconButton label="Create group" onClick={() => setNewGroup(true)}>
                  <Plus />
                </IconButton>
              )}
              {/* Starred holds other people's links, so a separator sets it apart from yours. */}
              <span className="profile-filter-separator" aria-hidden="true" />
              <button
                type="button"
                aria-pressed={starredTab}
                onClick={() => select(starredGroup?.id ?? "starred")}
              >
                <Star size={14} aria-hidden="true" />
                Starred
              </button>
            </div>
            {/* A fixed home for list settings, so showing them never shifts the filters. */}
            {own && selected && (
              <ListActions group={selected} onDeleted={() => select(undefined)} />
            )}
          </nav>
          {groups.error && <QueryState error={groups.error} retry={() => void groups.refetch()} />}
          {filter === "starred" && !starredGroup && (
            <p className="empty-state">No starred links yet.</p>
          )}
          {(filter === "all" || selected) && (
            <ProfileLibrary key={filter} userId={profile.id} group={selected} own={own} />
          )}
        </>
      )}
      {connections && <Connections initial={connections} onClose={() => setConnections(null)} />}
      {newGroup && (
        <NewGroup
          onClose={() => setNewGroup(false)}
          onCreated={(id) => {
            setNewGroup(false);
            void navigate({ to: ".", search: (old) => ({ ...old, group: id }) });
          }}
        />
      )}
    </div>
  );
}
function ProfileLibrary({ userId, group, own }: { userId: string; group?: Group; own: boolean }) {
  const list = useLibraryWeeks(userId, group?.id),
    canAdd = own && (!group || group.kind === "custom"),
    weeks = [
      ...new Set([
        ...(canAdd ? [monday()] : []),
        ...(list.data?.pages.flatMap((p) => p.items.map((w) => w.weekStart)) ?? []),
      ]),
    ]
      .sort()
      .reverse();
  return (
    <QueryState pending={list.isPending} error={list.error} retry={() => void list.refetch()}>
      {weeks.map((week) => (
        <section className="profile-week" key={week}>
          <h2>
            {weekLabel(week)}
            <span>{weekRange(week)}</span>
          </h2>
          <div className="profile-links">
            <WeekLinks
              userId={userId}
              week={week}
              groupId={group?.id}
              add={canAdd && week === monday()}
            />
          </div>
        </section>
      ))}
      {!weeks.length && <p className="empty-state">No links yet.</p>}
      <More
        hasNext={list.hasNextPage}
        isFetching={list.isFetchingNextPage}
        fetch={list.fetchNextPage}
      />
    </QueryState>
  );
}
// Lock applies to every list of yours; only your own groups can be renamed or deleted.
function ListActions({ group, onDeleted }: { group: Group; onDeleted: () => void }) {
  const actions = useLibraryActions(),
    [edit, setEdit] = useState(false),
    [name, setName] = useState(group.name),
    [remove, setRemove] = useState(false),
    locked = group.visibility === "private";
  return (
    <div className="profile-list-actions">
      <IconButton
        label={locked ? "Unlock " + group.name : "Lock " + group.name}
        disabled={actions.updateGroup.isPending}
        onClick={() =>
          actions.updateGroup.mutate({ id: group.id, visibility: locked ? "public" : "private" })
        }
      >
        {locked ? <LockKeyhole /> : <LockKeyholeOpen />}
      </IconButton>
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
              onSuccess: () => {
                setRemove(false);
                onDeleted();
              },
            },
          )
        }
      />
    </div>
  );
}
function NewGroup({
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
