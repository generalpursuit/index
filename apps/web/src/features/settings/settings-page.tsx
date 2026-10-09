import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { ChevronDown, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Field, FieldLabel, FieldError } from "@index/ui/components/field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@index/ui/components/dropdown-menu";
import { updateProfileSchema } from "@index/api/features/profiles/schemas";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Back,
  Confirmation,
  IconButton,
  Modal,
  QueryState,
  UserAvatar,
} from "@/components/app/primitives";
import { useViewer } from "@/hooks/use-api";
import { useProfile, useProfileActions } from "@/features/profiles/hooks/use-profiles";
import { squarePhoto } from "@/lib/photo";
import type { Profile } from "@/lib/types";
import { useSignOut } from "./hooks/use-sign-out";
import { GroupSettings } from "./groups";

/** Settings as a page, reached from your profile. */
export function SettingsPage() {
  const viewer = useViewer();
  return (
    <div className="settings-page">
      <header className="page-heading">
        <Back fallback={viewer ? "/people/" + viewer.id : "/"} />
        <h1>Settings</h1>
      </header>
      {viewer ? <SettingsContent userId={viewer.id} /> : <QueryState pending />}
    </div>
  );
}

/** Shared account settings content. */
export function SettingsContent({ userId }: { userId: string }) {
  const profile = useProfile(userId);
  return (
    <QueryState
      pending={profile.isPending}
      error={profile.error}
      retry={() => void profile.refetch()}
    >
      {profile.data && <SettingsBoxes key={userId} profile={profile.data} />}
    </QueryState>
  );
}

/** One box per concern: who you are, who sees your links, your lists, and signing out. */
function SettingsBoxes({ profile }: { profile: Profile }) {
  const signOut = useSignOut();
  // Editing opens with a freshly picked photo when the avatar was tapped.
  const [editing, setEditing] = useState<{ photo?: File } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="settings-content">
      <section className="settings-box settings-profile" aria-label="Profile">
        <button
          type="button"
          className="settings-photo"
          aria-label="Change photo"
          onClick={() => picker.current?.click()}
        >
          <UserAvatar person={profile} large />
        </button>
        <PhotoPicker input={picker} onPick={(photo) => setEditing({ photo })} />
        <div className="settings-identity">
          <strong>{profile.name}</strong>
          {profile.username && <span>{profile.username}</span>}
        </div>
        <IconButton label="Edit profile" className="settings-edit" onClick={() => setEditing({})}>
          <Pencil />
        </IconButton>
      </section>
      <ProfileVisibility profile={profile} />
      <GroupSettings userId={profile.id} />
      <button
        type="button"
        className="settings-box settings-sign-out"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        {signOut.isPending ? "Signing out…" : "Sign out"}
      </button>
      {signOut.error && (
        <p role="alert" className="field-error settings-sign-out-error">
          {signOut.error.message}
        </p>
      )}
      {editing && (
        <EditProfile profile={profile} photo={editing.photo} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** A hidden file input; picking an image hands it on. */
function PhotoPicker({
  input,
  onPick,
}: {
  input: RefObject<HTMLInputElement | null>;
  onPick: (photo: File) => void;
}) {
  return (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      onChange={(event) => {
        const photo = event.target.files?.[0];
        event.target.value = "";
        if (photo) onPick(photo);
      }}
    />
  );
}

/**
 * Photo, name and username, saved together. A new photo is squared and shrunk in the browser,
 * then uploaded; removing it deletes the stored one.
 */
function EditProfile({
  profile,
  photo: picked,
  onClose,
}: {
  profile: Profile;
  photo?: File;
  onClose: () => void;
}) {
  const { update, uploadImage } = useProfileActions();
  // `undefined` keeps the current photo, `null` removes it, a File replaces it.
  const [photo, setPhoto] = useState<File | null | undefined>(picked);
  const preview = usePreview(photo);
  const picker = useRef<HTMLInputElement>(null);
  const saving = update.isPending || uploadImage.isPending;
  const form = useForm({
    defaultValues: { name: profile.name, username: profile.username ?? "" },
    validators: {
      onSubmit: z.object({
        name: updateProfileSchema.shape.name.unwrap(),
        username: z
          .union([updateProfileSchema.shape.username.unwrap(), z.literal("")])
          .refine((value) => !profile.username || value.length > 0, "Enter a username."),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        if (photo) await uploadImage.mutateAsync({ image: await squarePhoto(photo) });
        const name = value.name.trim();
        const username = value.username || undefined;
        if (name !== profile.name || username !== (profile.username ?? undefined) || photo === null)
          await update.mutateAsync({ name, username, ...(photo === null ? { image: null } : {}) });
        toast.success("Profile saved");
        onClose();
      } catch {
        // Errors show below; the fields keep what was typed.
      }
    },
  });
  const shown = photo === null ? null : (preview ?? profile.image);
  const error = uploadImage.error ?? update.error;
  return (
    <Modal
      open
      title="Edit profile"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form
        className="form-stack edit-profile"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="edit-profile-photo">
          <button
            type="button"
            className="settings-photo"
            aria-label="Choose photo"
            onClick={() => picker.current?.click()}
          >
            <UserAvatar person={{ ...profile, image: shown }} large />
          </button>
          <div className="edit-profile-photo-actions">
            <Button type="button" variant="ghost" onClick={() => picker.current?.click()}>
              {shown ? "Change photo" : "Add photo"}
            </Button>
            {shown && (
              <Button type="button" variant="ghost" onClick={() => setPhoto(null)}>
                Remove photo
              </Button>
            )}
          </div>
          <PhotoPicker input={picker} onPick={setPhoto} />
        </div>
        {(
          [
            { name: "name", label: "Name", autoComplete: "name", max: 80 },
            { name: "username", label: "Username", autoComplete: "username", max: 30 },
          ] as const
        ).map((input) => (
          <form.Field key={input.name} name={input.name}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel className="link-form-label" htmlFor={"profile-" + input.name}>
                  {input.label}
                </FieldLabel>
                <Input
                  id={"profile-" + input.name}
                  name={input.name}
                  autoComplete={input.autoComplete}
                  autoCapitalize={input.name === "name" ? "words" : "none"}
                  spellCheck={false}
                  maxLength={input.max}
                  value={field.state.value}
                  disabled={saving}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={"profile-" + input.name + "-error"}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldError
                  id={"profile-" + input.name + "-error"}
                  errors={field.state.meta.errors}
                />
              </Field>
            )}
          </form.Field>
        ))}
        {error && (
          <p role="alert" className="field-error">
            {error.message}
          </p>
        )}
        <div className="modal-actions">
          <Button type="button" variant="ghost" className="modal-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A temporary address for a picked photo, released when it changes. */
function usePreview(photo: File | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) {
      setUrl(null);
      return;
    }
    const address = URL.createObjectURL(photo);
    setUrl(address);
    return () => URL.revokeObjectURL(address);
  }, [photo]);
  return url;
}

// Visibility decides who sees every link outside a locked group, so changes need confirming.
function ProfileVisibility({ profile }: { profile: Profile }) {
  const { update } = useProfileActions();
  const [next, setNext] = useState<"public" | "private" | null>(null);
  const current = profile.profileVisibility;
  return (
    <section className="settings-box settings-visibility" aria-labelledby="settings-visibility">
      <div>
        <h2 id="settings-visibility">Profile visibility</h2>
        <p className="muted">
          {current === "private"
            ? "Only approved followers see your links."
            : "Anyone can see your links."}{" "}
          Locked groups are always only yours.
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className="list-filter"
              aria-label={"Profile visibility: " + current}
            />
          }
        >
          {current === "private" ? "Private" : "Public"}
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={current}
            onValueChange={(value) => {
              if (value !== current) setNext(value as "public" | "private");
            }}
          >
            <DropdownMenuRadioItem value="public">Public</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="private">Private</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Confirmation
        open={next !== null}
        onOpenChange={(open) => {
          if (!open) setNext(null);
        }}
        title={next === "private" ? "Make profile private?" : "Make profile public?"}
        description={
          next === "private"
            ? "Only approved followers will see your links. Existing followers keep access. Locked groups remain only yours."
            : "Anyone can see your links. Pending follow requests will be accepted. Locked groups remain only yours."
        }
        pending={update.isPending}
        onConfirm={() =>
          next && update.mutate({ profileVisibility: next }, { onSuccess: () => setNext(null) })
        }
      />
    </section>
  );
}
