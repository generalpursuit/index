import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@index/ui/components/input";
import { Textarea } from "@index/ui/components/textarea";
import { Button } from "@index/ui/components/button";
import { Field, FieldLabel, FieldError } from "@index/ui/components/field";
import { ModalFooter } from "@index/ui/components/modal";
import { createLinkInputSchema } from "@index/api/features/links/schemas";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { QueryState, More } from "@/components/app/query-state";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useLinkDrafts } from "./drafts";
import type { LinkDraft } from "./draft";
import { useLibraryActions } from "./hooks/use-links";
import { useGroups } from "@/features/groups/use-groups";
import type { SavedLink } from "@/lib/types";
/**
 * Edits a saved link: its address, title, note and group. Links are added by pasting them into
 * the "Enter a link" field, so this is the only form for a link. Calls `onDone` after saving.
 */
export function LinkEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const api = useAPI(),
    existing = useQuery(api.links.get.queryOptions({ input: { id } }));
  return (
    <QueryState
      pending={existing.isPending}
      hasData={!!existing.data}
      error={existing.error}
      retry={() => void existing.refetch()}
    >
      {existing.data && <LinkForm key={id} existing={existing.data} onDone={onDone} />}
    </QueryState>
  );
}
function LinkForm({ existing, onDone }: { existing: SavedLink; onDone: () => void }) {
  const viewer = useViewer()!,
    groups = useGroups(viewer.id),
    actions = useLibraryActions();
  const saved: LinkDraft = {
    url: existing.url,
    title: existing.title,
    description: existing.description ?? "",
    groupId: existing.groupId,
  };
  const drafts = useLinkDrafts();
  const draft = drafts.read(existing.id, saved);
  const form = useForm({
    defaultValues: draft,
    validators: {
      onSubmit: createLinkInputSchema.extend({
        title: z.string().trim().min(1, "Give the link a title.").max(500),
        description: createLinkInputSchema.shape.description.unwrap().unwrap(),
        groupId: createLinkInputSchema.shape.groupId.unwrap(),
      }),
    },
    onSubmit: async ({ value }) => {
      const { url, title, description, groupId } = value;
      const submitted = drafts.read(existing.id, saved);
      try {
        await actions.update.mutateAsync({
          id: existing.id,
          url,
          title: title.trim(),
          description,
          groupId,
        });
        drafts.complete(existing.id, submitted);
        toast.success("Link saved");
        onDone();
      } catch {
        /* Mutation errors are shown by the query client; keep the draft. */
      }
    },
  });
  const saving = actions.update.isPending;
  const customGroups =
    groups.data?.pages.flatMap((p) => p.items).filter((g) => g.kind === "custom") ?? [];
  const change = (name: keyof LinkDraft, value: string | null) =>
    drafts.edit(existing.id, { ...form.state.values, [name]: value });
  return (
    <form
      className={
        "link-form flex flex-col gap-6 max-w-140 [&_label.link-form-label]:font-mono [&_label.link-form-label]:text-[11px] [&_label.link-form-label]:font-normal [&_label.link-form-label]:tracking-[0.06em] [&_label.link-form-label]:uppercase [&_label.link-form-label]:text-subtle-foreground"
      }
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="url">
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel
              className={
                "link-form-label font-mono text-[11px] font-normal tracking-[0.06em] uppercase text-subtle-foreground"
              }
              htmlFor="link-url"
            >
              Link
            </FieldLabel>
            <Input
              variant="surface"
              id="link-url"
              type="url"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => {
                field.handleChange(e.target.value);
                change("url", e.target.value);
              }}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Field name="title">
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel
              className={
                "link-form-label font-mono text-[11px] font-normal tracking-[0.06em] uppercase text-subtle-foreground"
              }
              htmlFor="link-title"
            >
              Title
            </FieldLabel>
            <Input
              variant="surface"
              id="link-title"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => {
                field.handleChange(e.target.value);
                change("title", e.target.value);
              }}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Field name="description">
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel
              className={
                "link-form-label font-mono text-[11px] font-normal tracking-[0.06em] uppercase text-subtle-foreground"
              }
              htmlFor="link-note"
            >
              Note
            </FieldLabel>
            <Textarea
              variant="surface"
              className="max-h-60"
              id="link-note"
              rows={1}
              placeholder="Why it caught your eye (optional)"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => {
                field.handleChange(e.target.value);
                change("description", e.target.value);
              }}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Field name="groupId">
        {(field) => {
          const chosen = customGroups.find((g) => g.id === field.state.value);
          const choose = (id: string | null) => {
            field.handleChange(id);
            change("groupId", id);
          };
          return (
            <div className={"link-form-group flex flex-col gap-2.5 [&_.muted]:text-[13px]"}>
              <span
                className={
                  "link-form-label font-mono text-[11px] font-normal tracking-[0.06em] uppercase text-subtle-foreground"
                }
                id="link-group-label"
              >
                Group
              </span>
              <div
                className={
                  "link-group-choices flex flex-wrap items-center gap-[6px_22px] [&_[role='radio']]:inline-flex [&_[role='radio']]:items-center [&_[role='radio']]:gap-1.5 [&_[role='radio']]:h-8 [&_[role='radio']]:[border-bottom:2px_solid_transparent] [&_[role='radio']]:text-[14px] [&_[role='radio']]:text-subtle-foreground [&_[role='radio']:hover]:text-foreground [&_[aria-checked='true']]:border-b-foreground [&_[aria-checked='true']]:text-foreground"
                }
                role="radiogroup"
                aria-labelledby="link-group-label"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!field.state.value}
                  onClick={() => choose(null)}
                >
                  No group
                </button>
                {customGroups.map((g) => (
                  <button
                    type="button"
                    role="radio"
                    key={g.id}
                    aria-checked={field.state.value === g.id}
                    onClick={() => choose(g.id)}
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
              </div>
              <p className={"muted text-subtle-foreground"}>
                {chosen?.visibility === "private"
                  ? "Only you will see this link."
                  : "Visible to everyone who can see your profile."}
              </p>
            </div>
          );
        }}
      </form.Field>
      <ModalFooter onCancel={onDone}>
        <Button type="submit" disabled={saving}>
          Save changes
        </Button>
      </ModalFooter>
    </form>
  );
}
