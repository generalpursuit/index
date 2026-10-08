import { z } from "zod";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Textarea } from "@index/ui/components/textarea";
import { useForm } from "@tanstack/react-form";
import { LockKeyhole, LockKeyholeOpen, Plus, Heart, Star, Link2, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  Back,
  UserAvatar,
  QueryState,
  Choice,
  Modal,
  Confirmation,
  More,
  IconButton,
} from "@/components/app/primitives";
import { useViewer } from "@/hooks/use-api";
import { useProfile, useProfileActions } from "./hooks/use-profiles";
import { useGroups, useLibraryWeeks, useLibraryActions } from "@/features/links/hooks/use-links";
import { WeekLinks } from "@/features/feed/feed-page";
import { monday, weekLabel } from "@/lib/weeks";
import { Connections } from "./connections";
import type { Profile, Person, Group } from "@/lib/types";
import { updateProfileSchema } from "@index/api/features/profiles/schemas";
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
    navigate = useNavigate(),
    actions = useProfileActions();
  const [connections, setConnections] = useState<"followers" | "following" | null>(null),
    [edit, setEdit] = useState(false),
    [privacy, setPrivacy] = useState<"public" | "private" | null>(null),
    [newGroup, setNewGroup] = useState(false);
  const groups = useGroups(profile.id),
    allGroups = groups.data?.pages.flatMap((p) => p.items) ?? [],
    selected = allGroups.find((g) => g.id === filter);
  const hidden = !profile.canViewContent;
  return (
    <div className="profile-page">
      {!own && <Back fallback="/discover" />}
      <header className="profile-heading">
        <div>
          <h1>{profile.username ?? profile.name}</h1>
          <p className="muted">{profile.name}</p>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        </div>
        <UserAvatar person={profile} large />
      </header>
      <div className="profile-stats">
        {profile.linkCount !== null && (
          <span>
            <Link2 size={16} />
            {profile.linkCount} links
          </span>
        )}
        {own && (
          <>
            <Button variant="ghost" onClick={() => setConnections("followers")}>
              {profile.followerCount ?? 0} followers
            </Button>
            <Button variant="ghost" onClick={() => setConnections("following")}>
              {profile.followingCount ?? 0} following
            </Button>
          </>
        )}
      </div>
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
      {!hidden && (
        <div className="profile-actions">
          {own ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(new URL("/people/" + encodeURIComponent(profile.id), location.origin).href).then(
                    () => toast.success("Profile link copied"),
                    () => toast.error("Could not copy link"),
                  );
                }}
              >
                <Copy size={16} />
                Share
              </Button>
              <Choice
                label="Profile visibility"
                value={profile.profileVisibility}
                onChange={(v) => {
                  if (v !== profile.profileVisibility) setPrivacy(v as "public" | "private");
                }}
                options={[
                  { value: "public", label: "Public" },
                  { value: "private", label: "Private" },
                ]}
              />
              <IconButton label="Edit profile" onClick={() => setEdit(true)}>
                <Pencil />
              </IconButton>
            </>
          ) : (
            <FollowButton person={profile} />
          )}
        </div>
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
          <div className="filter-strip">
            <Button
              aria-pressed={filter === "all"}
              variant={filter === "all" ? "default" : "outline"}
              onClick={() =>
                void navigate({ to: ".", search: (old) => ({ ...old, group: undefined }) })
              }
            >
              All
            </Button>
            {own && (
              <Button
                aria-pressed={filter === "inbox"}
                variant={filter === "inbox" ? "default" : "outline"}
                onClick={() =>
                  void navigate({ to: ".", search: (old) => ({ ...old, group: "inbox" }) })
                }
              >
                Inbox
              </Button>
            )}
            {allGroups.map((g) => (
              <Button
                key={g.id}
                aria-pressed={filter === g.id}
                variant={filter === g.id ? "default" : "outline"}
                onClick={() =>
                  void navigate({ to: ".", search: (old) => ({ ...old, group: g.id }) })
                }
              >
                {g.kind === "favorites" ? (
                  <Heart size={14} />
                ) : g.kind === "starred" ? (
                  <Star size={14} />
                ) : g.visibility === "private" ? (
                  <LockKeyhole size={14} />
                ) : null}
                {g.name}
              </Button>
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
          </div>
          {groups.error && <QueryState error={groups.error} retry={() => void groups.refetch()} />}
          {own && selected && (
            <GroupControl
              group={selected}
              onDeleted={() =>
                void navigate({ to: ".", search: (old) => ({ ...old, group: undefined }) })
              }
            />
          )}
          {filter === "inbox" && (
            <p className="group-lock">
              <LockKeyhole size={14} />
              Inbox is locked
            </p>
          )}
          {(filter === "all" || filter === "inbox" || selected) && (
            <ProfileLibrary
              key={filter}
              userId={profile.id}
              group={selected}
              inbox={filter === "inbox"}
              own={own}
            />
          )}
        </>
      )}
      {connections && <Connections initial={connections} onClose={() => setConnections(null)} />}
      {edit && <EditProfile profile={profile} onClose={() => setEdit(false)} />}
      {newGroup && (
        <NewGroup
          onClose={() => setNewGroup(false)}
          onCreated={(id) => {
            setNewGroup(false);
            void navigate({ to: ".", search: (old) => ({ ...old, group: id }) });
          }}
        />
      )}
      <Confirmation
        open={privacy !== null}
        onOpenChange={(v) => {
          if (!v) setPrivacy(null);
        }}
        title={privacy === "private" ? "Make profile private?" : "Make profile public?"}
        description={
          privacy === "private"
            ? "Only approved followers will see posts in unlocked groups. Existing followers keep access. Inbox and locked groups remain only yours."
            : "Anyone can see posts in unlocked groups. Pending follow requests will be accepted. Inbox and locked groups remain only yours."
        }
        pending={actions.update.isPending}
        onConfirm={() =>
          privacy &&
          actions.update.mutate(
            { profileVisibility: privacy },
            { onSuccess: () => setPrivacy(null) },
          )
        }
      />
    </div>
  );
}
function ProfileLibrary({
  userId,
  group,
  inbox,
  own,
}: {
  userId: string;
  group?: Group;
  inbox: boolean;
  own: boolean;
}) {
  const list = useLibraryWeeks(userId, group?.id, inbox),
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
            {week.slice(0, 4) !== monday().slice(0, 4) && " · " + week.slice(0, 4)}
          </h2>
          <div className="profile-links">
            <WeekLinks userId={userId} week={week} groupId={group?.id} inbox={inbox} add={canAdd} />
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
function GroupControl({ group, onDeleted }: { group: Group; onDeleted: () => void }) {
  const actions = useLibraryActions(),
    [edit, setEdit] = useState(false),
    [name, setName] = useState(group.name),
    [remove, setRemove] = useState(false);
  return (
    <div className="group-lock">
      <Button
        variant="ghost"
        disabled={actions.updateGroup.isPending}
        onClick={() =>
          actions.updateGroup.mutate({
            id: group.id,
            visibility: group.visibility === "private" ? "public" : "private",
          })
        }
      >
        {group.visibility === "private" ? <LockKeyhole size={16} /> : <LockKeyholeOpen size={16} />}
        {group.visibility === "private" ? "Locked" : "Unlocked"}
      </Button>
      {group.kind === "custom" && (
        <Button variant="ghost" onClick={() => setEdit(true)}>
          Edit group
        </Button>
      )}
      <Modal open={edit} onOpenChange={setEdit} title="Edit group">
        <Input aria-label="Group name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          disabled={!name.trim() || actions.updateGroup.isPending}
          onClick={() =>
            actions.updateGroup.mutate({ id: group.id, name }, { onSuccess: () => setEdit(false) })
          }
        >
          Save
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            setEdit(false);
            setRemove(true);
          }}
        >
          Delete group
        </Button>
      </Modal>
      <Modal
        open={remove}
        onOpenChange={setRemove}
        title="Delete group?"
        description="The group will be deleted. Its links will move to your locked Inbox."
      >
        <Button
          variant="destructive"
          disabled={actions.deleteGroup.isPending}
          onClick={() =>
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
        >
          Delete group
        </Button>
      </Modal>
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
        <Input
          autoFocus
          aria-label="Group name"
          placeholder="Group name"
          maxLength={100}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="button" variant="outline" onClick={() => setLocked(!locked)}>
          {locked ? <LockKeyhole /> : <LockKeyholeOpen />}
          {locked ? "Locked · Only you" : "Unlocked · Follows profile privacy"}
        </Button>
        <Button type="submit" disabled={!name.trim() || actions.createGroup.isPending}>
          Create
        </Button>
      </form>
    </Modal>
  );
}
function EditProfile({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const actions = useProfileActions();
  const form = useForm({
    defaultValues: { name: profile.name, username: profile.username ?? "", bio: profile.bio ?? "" },
    validators: {
      onSubmit: z.object({
        name: updateProfileSchema.shape.name.unwrap(),
        username: z.union([updateProfileSchema.shape.username.unwrap(), z.literal("")]),
        bio: updateProfileSchema.shape.bio.unwrap().unwrap(),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        await actions.update.mutateAsync({ ...value, username: value.username || undefined });
        onClose();
      } catch {
        /* Keep the form available for correction. */
      }
    },
  });
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Edit profile"
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {(["name", "username", "bio"] as const).map((name) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <label className="field-label">
                {name === "name" ? "Name" : name === "username" ? "Username" : "Bio"}
                {name === "bio" ? (
                  <Textarea
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                ) : (
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
                <span className="field-error">
                  {field.state.meta.errors.map((e) => e?.message).join(", ")}
                </span>
              </label>
            )}
          </form.Field>
        ))}
        <Button type="submit" disabled={actions.update.isPending}>
          Save
        </Button>
      </form>
    </Modal>
  );
}
