import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Field, FieldLabel, FieldError, FieldDescription } from "@index/ui/components/field";
import { updateProfileSchema } from "@index/api/features/profiles/schemas";
import { useState } from "react";
import { Back, Choice, Confirmation, QueryState, UserAvatar } from "@/components/app/primitives";
import { useViewer } from "@/hooks/use-api";
import { useProfile, useProfileActions } from "@/features/profiles/hooks/use-profiles";
import type { Profile } from "@/lib/types";
import { useSignOut } from "./hooks/use-sign-out";
import { GroupSettings } from "./groups";

const imageSchema = z
  .string()
  .trim()
  .pipe(z.union([updateProfileSchema.shape.image.unwrap().unwrap(), z.literal("")]));

export function SettingsPage() {
  const viewer = useViewer();
  return viewer ? <AccountSettings userId={viewer.id} /> : <QueryState pending />;
}

function AccountSettings({ userId }: { userId: string }) {
  const profile = useProfile(userId);
  return (
    <div className="settings-page">
      <header className="page-heading">
        <Back fallback={"/people/" + userId} />
        <h1>Settings</h1>
      </header>
      <QueryState
        pending={profile.isPending}
        error={profile.error}
        retry={() => void profile.refetch()}
      >
        {profile.data && <SettingsForm key={userId} profile={profile.data} />}
      </QueryState>
    </div>
  );
}

function SettingsForm({ profile }: { profile: Profile }) {
  const { update } = useProfileActions();
  const signOut = useSignOut();
  const form = useForm({
    defaultValues: {
      name: profile.name,
      username: profile.username ?? "",
      image: profile.image ?? "",
    },
    validators: {
      onSubmit: z.object({
        name: updateProfileSchema.shape.name.unwrap(),
        username: z
          .union([updateProfileSchema.shape.username.unwrap(), z.literal("")])
          .refine((value) => !profile.username || value.length > 0, "Enter a username."),
        image: imageSchema,
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        const saved = await update.mutateAsync({
          name: value.name.trim(),
          username: value.username || undefined,
          image: value.image.trim() || null,
        });
        form.reset({ name: saved.name, username: saved.username ?? "", image: saved.image ?? "" });
        toast.success("Profile saved");
      } catch {
        // Keep unsaved fields intact so a failed save can be corrected or retried.
      }
    },
  });
  return (
    <div className="settings-content">
      <form
        className="form-stack settings-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <div className="settings-photo">
              <UserAvatar
                person={{
                  id: profile.id,
                  name: values.name || profile.name,
                  image: imageSchema.safeParse(values.image).success
                    ? values.image.trim() || null
                    : null,
                }}
                large
              />
              <div>
                <h2>Profile photo</h2>
                <p className="muted">Your photo, or your initials.</p>
                {values.image && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={update.isPending || signOut.isPending}
                    onClick={() => form.setFieldValue("image", "")}
                  >
                    Remove photo
                  </Button>
                )}
              </div>
            </div>
          )}
        </form.Subscribe>
        {(
          [
            { name: "name", label: "Name", autoComplete: "name" },
            { name: "username", label: "Username", autoComplete: "username" },
            { name: "image", label: "Image URL", autoComplete: "off" },
          ] as const
        ).map((input) => (
          <form.Field key={input.name} name={input.name}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={"settings-" + input.name}>{input.label}</FieldLabel>
                <Input
                  id={"settings-" + input.name}
                  name={input.name}
                  type={input.name === "image" ? "url" : "text"}
                  autoComplete={input.autoComplete}
                  autoCapitalize={input.name === "name" ? "words" : "none"}
                  spellCheck={false}
                  maxLength={input.name === "name" ? 80 : input.name === "username" ? 30 : 8192}
                  value={field.state.value}
                  disabled={update.isPending || signOut.isPending}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={
                    "settings-" +
                    input.name +
                    "-error" +
                    (input.name === "image" ? " settings-image-hint" : "")
                  }
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    update.reset();
                  }}
                />
                {input.name === "image" && (
                  <FieldDescription id="settings-image-hint">
                    Paste an image link, or leave blank to use your initials.
                  </FieldDescription>
                )}
                <FieldError
                  id={"settings-" + input.name + "-error"}
                  errors={field.state.meta.errors}
                />
              </Field>
            )}
          </form.Field>
        ))}
        {update.error && (
          <p role="alert" className="field-error">
            {update.error.message}
          </p>
        )}
        <form.Subscribe selector={(state) => [state.isPristine, state.isSubmitting]}>
          {([pristine, submitting]) => (
            <Button
              className="settings-save"
              type="submit"
              disabled={pristine || submitting || signOut.isPending}
            >
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <ProfileVisibility profile={profile} />
      <GroupSettings userId={profile.id} />
      <div className="settings-session">
        <Button
          variant="outline"
          disabled={signOut.isPending || update.isPending}
          onClick={() => signOut.mutate()}
        >
          <LogOut size={16} />
          {signOut.isPending ? "Signing out…" : "Sign out"}
        </Button>
        {signOut.error && (
          <p role="alert" className="field-error">
            {signOut.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

// Visibility decides who sees every link outside a locked group, so changes need confirming.
function ProfileVisibility({ profile }: { profile: Profile }) {
  const { update } = useProfileActions();
  const [next, setNext] = useState<"public" | "private" | null>(null);
  return (
    <section className="settings-visibility">
      <div>
        <h2>Profile visibility</h2>
        <p className="muted">
          {profile.profileVisibility === "private"
            ? "Only approved followers see your links."
            : "Anyone can see your links."}{" "}
          Locked groups are always only yours.
        </p>
      </div>
      <Choice
        label="Profile visibility"
        value={profile.profileVisibility}
        onChange={(value) => {
          if (value !== profile.profileVisibility) setNext(value as "public" | "private");
        }}
        options={[
          { value: "public", label: "Public" },
          { value: "private", label: "Private" },
        ]}
      />
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
