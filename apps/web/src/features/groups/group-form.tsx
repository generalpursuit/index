import { useId, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { createGroupSchema, type CreateGroupInput } from "@index/api/features/groups/schemas";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Confirmation } from "@index/ui/components/confirmation";
import { ModalFooter } from "@index/ui/components/modal";
import type { Group } from "@/lib/types";
import { GroupLockControl, groupPrivacyDescription } from "./group-lock-control";

export function groupSaveError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error.code === "CONFLICT")
    return "That group name or address is already reserved. Choose another name.";
  return error instanceof Error ? error.message : "Couldn’t save this group. Try again.";
}

function nameError(value: string) {
  const result = createGroupSchema.shape.name.safeParse(value);
  if (result.success) return undefined;
  const issue = result.error.issues[0];
  if (issue?.code === "too_small") return "Give the group a name.";
  if (issue?.code === "too_big") return "Use 100 characters or fewer.";
  return issue?.message ?? "Choose another group name.";
}

/** Caller owns dismissal. Input survives validation and request errors until explicitly closed. */
export function GroupForm({
  group,
  onSave,
  onClose,
  pending,
}: {
  group?: Group;
  onSave: (value: CreateGroupInput) => Promise<unknown>;
  onClose: () => void;
  pending: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [locked, setLocked] = useState(
    group?.kind === "starred" || group?.visibility === "private",
  );
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<CreateGroupInput>();
  const save = async (value: CreateGroupInput) => {
    if (submitting.current) return;
    submitting.current = true;
    setError(undefined);
    try {
      await onSave(value);
    } catch (cause) {
      setConfirmation(undefined);
      setError(groupSaveError(cause));
      input.current?.focus();
    } finally {
      submitting.current = false;
    }
  };
  const form = useForm({
    defaultValues: { name: group?.name ?? "" },
    onSubmitInvalid: () => input.current?.focus(),
    onSubmit: async ({ value }) => {
      const parsed = createGroupSchema.parse({
        name: value.name,
        visibility: locked ? "private" : "public",
      });
      if (group && parsed.visibility !== group.visibility) setConfirmation(parsed);
      else await save(parsed);
    },
  });
  return (
    <>
      <form
        className="flex flex-col gap-5"
        noValidate
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && !submitting.current && !confirmation) void form.handleSubmit();
        }}
      >
        <form.Field name="name" validators={{ onChange: ({ value }) => nameError(value) }}>
          {(field) => {
            const validation = field.state.meta.isTouched ? field.state.meta.errors[0] : undefined;
            return (
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-sm text-muted-foreground" htmlFor={id}>
                  Name
                </label>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    ref={input}
                    id={id}
                    className="min-w-0 flex-1 text-base!"
                    placeholder="Reading, Wishlist, …"
                    value={field.state.value}
                    disabled={pending}
                    aria-invalid={!!validation || !!error}
                    aria-describedby={`${id}-privacy${validation || error ? ` ${id}-error` : ""}`}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      setError(undefined);
                      field.handleChange(event.target.value);
                    }}
                  />
                  <GroupLockControl
                    locked={locked}
                    onChange={setLocked}
                    alwaysPrivate={group?.kind === "starred"}
                    disabled={pending}
                    describedBy={`${id}-privacy`}
                  />
                </div>
                <p
                  id={`${id}-privacy`}
                  className="text-sm text-muted-foreground"
                  aria-live="polite"
                >
                  {groupPrivacyDescription(locked)}
                </p>
                {(validation || error) && (
                  <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                    {validation || error}
                  </p>
                )}
              </div>
            );
          }}
        </form.Field>
        {pending && (
          <p className="sr-only" role="status">
            {group ? "Saving group…" : "Creating group…"}
          </p>
        )}
        <ModalFooter>
          {/* Unlike the footer's own Cancel, this one stays on sheets and waits for a pending write. */}
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? (group ? "Saving…" : "Creating…") : group ? "Save" : "Create"}
          </Button>
        </ModalFooter>
      </form>
      <Confirmation
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(undefined);
        }}
        title={locked ? "Lock group?" : "Unlock group?"}
        description={groupPrivacyDescription(locked)}
        label={locked ? "Lock and save" : "Unlock and save"}
        pending={pending}
        onConfirm={() => {
          if (confirmation) void save(confirmation);
        }}
      />
    </>
  );
}
