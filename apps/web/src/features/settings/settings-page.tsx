import { placeholderProfile } from "@/data/placeholders";
import { NotificationSettings } from "@/features/notifications/settings";
import { DesktopUpdates } from "@/lib/desktop/updates";
import { AccountSecurity } from "@/features/auth/security-forms";
import { ThemeControl } from "@/features/settings/appearance";
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
import { useRef, useState, type RefObject } from "react";
import { Confirmation } from "@index/ui/components/confirmation";
import { IconButton } from "@index/ui/components/icon-button";
import { Modal, ModalFooter } from "@index/ui/components/modal";
import { QueryState } from "@/components/app/query-state";
import { Back } from "@/components/app/navigation";
import { profilePath } from "@/lib/routes";
import { UserAvatar } from "@/components/app/user-avatar";
import { useViewer } from "@/hooks/use-api";
import { useObjectURL } from "@/hooks/use-object-url";
import { useProfile, useProfileActions } from "@/features/profiles/hooks/use-profiles";
import { squarePhoto } from "@/lib/photo";
import type { Profile } from "@/lib/types";
import { useSignOut } from "./hooks/use-sign-out";
import { GroupSettings } from "./groups";
import { AppIconSettings } from "./app-icon";
import { DockSettings } from "./dock";
import { LaunchAtLoginSettings } from "./launch-at-login";
import { CurateeImport } from "./curatee-import";
import { MobileAppSettings } from "./mobile-app";

// Shared by instances in this component; markers remain available to scroll hooks/tests.
const settingsPhotoClassName =
  "settings-photo rounded-full [&:focus-visible]:[outline:2px_solid_var(--foreground)] [&:focus-visible]:outline-offset-[3px]";

/** Settings as a page: from the navigation rail on larger screens, and your profile on phones. */
export function SettingsPage() {
  const viewer = useViewer();
  return (
    <div
      className={
        "settings-page [&>.page-heading_h1]:font-serif [&>.page-heading_h1]:font-bold [&>.page-heading_h1]:[font-variation-settings:'opsz'_60] [&>.page-heading_h1]:tracking-[-0.015em] [&>.page-heading_h1]:leading-[1] [&>.page-heading_h1]:text-[clamp(44px,_5vw,_62px)] [@media(width<=700px)_and_(height<=740px)]:[&>.page-heading_h1]:text-[36px]"
      }
    >
      <header
        className={
          "page-heading flex items-center gap-3 mb-8 min-w-0 [&_h1]:flex-1 [&_h1]:min-w-0 [&_h1]:self-start [@media(width<=700px)]:mb-6.5 [@media(width<=700px)]:gap-1"
        }
      >
        {/* Phones come here from the profile; larger screens from the rail, which stays in view. */}
        {viewer?.username && (
          <span className="settings-back [@media(width>=701px)]:hidden">
            <Back fallback={profilePath(viewer.username)} />
          </span>
        )}
        <h1>Settings</h1>
      </header>
      {viewer ? <SettingsContent userId={viewer.id} /> : <QueryState pending />}
    </div>
  );
}

/** Everything in Settings, once your profile has loaded. */
function SettingsContent({ userId }: { userId: string }) {
  const profile = useProfile(userId);
  return (
    <QueryState
      placeholder={<SettingsBoxes profile={placeholderProfile} placeholder />}
      pending={profile.isPending}
      hasData={!!profile.data}
      error={profile.error}
      retry={() => void profile.refetch()}
    >
      {profile.data && <SettingsBoxes key={userId} profile={profile.data} />}
    </QueryState>
  );
}

/** One box per concern: who you are, who sees your links, your lists, imports, and signing out. */
function SettingsBoxes({
  profile,
  placeholder = false,
}: {
  profile: Profile;
  placeholder?: boolean;
}) {
  const signOut = useSignOut();
  // Editing opens with a freshly picked photo when the avatar was tapped.
  const [editing, setEditing] = useState<{ photo?: File } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div
      className={"settings-content flex flex-col gap-3.5"}
      data-placeholder={placeholder || undefined}
    >
      <section
        className={
          "settings-box p-[20px_22px] border border-border rounded-[18px] [&_h2]:text-[16px] [&_h2]:font-medium [&_h2+p]:mt-1 [&_h2+p]:text-[13px] settings-profile grid grid-cols-[auto_minmax(0,_1fr)_auto] items-center gap-4.5"
        }
        aria-label="Profile"
      >
        <button
          type="button"
          className={settingsPhotoClassName}
          aria-label="Change photo"
          onClick={() => picker.current?.click()}
        >
          <UserAvatar person={profile} large />
        </button>
        <PhotoPicker input={picker} onPick={(photo) => setEditing({ photo })} />
        <div
          className={
            "settings-identity flex flex-col gap-0.5 min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:font-serif [&_strong]:text-[24px] [&_strong]:font-bold [&_strong]:leading-[1.2] [&_span]:text-[14px] [&_span]:text-subtle-foreground"
          }
        >
          <strong>{profile.name}</strong>
          {profile.username && <span>{profile.username}</span>}
        </div>
        <IconButton
          label="Edit profile"
          className={
            "settings-edit [align-self:start] text-subtle-foreground [&:hover]:text-foreground"
          }
          onClick={() => setEditing({})}
        >
          <Pencil />
        </IconButton>
      </section>
      <section
        className={
          "settings-box p-[20px_22px] border border-border rounded-[18px] [&_h2]:text-[16px] [&_h2]:font-medium [&_h2+p]:mt-1 [&_h2+p]:text-[13px]"
        }
      >
        <ThemeControl />
      </section>
      <AppIconSettings />
      <DockSettings />
      <LaunchAtLoginSettings />
      <ProfileVisibility profile={profile} />
      <GroupSettings userId={profile.id} />
      <CurateeImport />
      <NotificationSettings />
      <AccountSecurity />
      <MobileAppSettings />
      <DesktopUpdates />
      <button
        type="button"
        className={
          "settings-box p-[20px_22px] border border-border rounded-[18px] [&_h2]:text-[16px] [&_h2]:font-medium [&_h2+p]:mt-1 [&_h2+p]:text-[13px] settings-sign-out w-full p-[15px_22px] text-[14px] font-medium text-foreground text-center [transition:background_120ms_ease] [&:hover]:bg-card [&:disabled]:opacity-[0.5]"
        }
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        {signOut.isPending ? "Signing out…" : "Sign out"}
      </button>
      {signOut.error && (
        <p
          role="alert"
          className={
            "field-error select-text text-[12px] text-destructive settings-sign-out-error text-center"
          }
        >
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
  const preview = useObjectURL(photo);
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
        className={"form-stack flex flex-col gap-4.5 edit-profile"}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className={"edit-profile-photo flex items-center gap-4.5"}>
          <button
            type="button"
            className={settingsPhotoClassName}
            aria-label="Choose photo"
            onClick={() => picker.current?.click()}
          >
            <UserAvatar person={{ ...profile, image: shown }} large />
          </button>
          <div className={"edit-profile-photo-actions flex flex-wrap gap-1"}>
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
                <FieldLabel
                  className={
                    "link-form-label font-mono text-[11px] font-normal tracking-[0.06em] uppercase text-subtle-foreground"
                  }
                  htmlFor={"profile-" + input.name}
                >
                  {input.label}
                </FieldLabel>
                <Input
                  variant="surface"
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
          <p role="alert" className={"field-error select-text text-[12px] text-destructive"}>
            {error.message}
          </p>
        )}
        <ModalFooter onCancel={onClose}>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// Visibility decides who sees every link outside a locked group, so changes need confirming.
function ProfileVisibility({ profile }: { profile: Profile }) {
  const { update } = useProfileActions();
  const [next, setNext] = useState<"public" | "private" | null>(null);
  const current = profile.profileVisibility;
  return (
    <section
      className={
        "settings-box p-[20px_22px] border border-border rounded-[18px] [&_h2]:text-[16px] [&_h2]:font-medium [&_h2+p]:mt-1 [&_h2+p]:text-[13px] settings-visibility flex items-center justify-between gap-5 [&_.list-filter]:flex-none"
      }
      aria-labelledby="settings-visibility"
    >
      <div>
        <h2 id="settings-visibility">Profile visibility</h2>
        <p className={"muted text-subtle-foreground"}>
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
              className={
                "list-filter gap-1.5 mr-[-8px] p-[0_8px] text-[14px] font-medium text-foreground [&_svg]:text-subtle-foreground [&_svg:last-child]:w-4 [&_svg:last-child]:h-4 [&_svg:last-child]:[transition:transform_150ms_ease] [&[aria-expanded='true']_svg:last-child]:[transform:rotate(180deg)]"
              }
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
        label={next === "private" ? "Make private" : "Make public"}
        pending={update.isPending}
        onConfirm={() =>
          next && update.mutate({ profileVisibility: next }, { onSuccess: () => setNext(null) })
        }
      />
    </section>
  );
}
