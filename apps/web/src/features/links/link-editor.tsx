import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Input } from "@index/ui/components/input";
import { Textarea } from "@index/ui/components/textarea";
import { Button } from "@index/ui/components/button";
import { Confirmation } from "@index/ui/components/confirmation";
import { Field, FieldLabel, FieldError } from "@index/ui/components/field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@index/ui/components/dropdown-menu";
import { createLinkInputSchema } from "@index/api/features/links/schemas";
import { ChevronDown, Globe, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { QueryState } from "@/components/app/query-state";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useLinkDrafts } from "./drafts";
import type { LinkDraft } from "./draft";
import { useLibraryActions } from "./hooks/use-links";
import { categoryMarkClassName } from "./category-mark";
import { useAllGroups } from "@/features/groups/use-groups";
import type { Group, SavedLink } from "@/lib/types";
/**
 * Edits a saved link: its address, title, note and group, laid out like the post itself, and
 * deletes it. Links are added by pasting them into the "Enter a link" field, so this is the
 * only form for a link. Calls `onDone` to close after saving or deleting.
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
// Fields show their frame only when hovered or focused, around the text rather than beside it.
const quietField =
  "min-h-0 rounded-md border-0 bg-transparent p-0 hover:bg-muted hover:ring-8 hover:ring-muted focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-8 focus-visible:ring-offset-background";
function LinkForm({ existing, onDone }: { existing: SavedLink; onDone: () => void }) {
  const viewer = useViewer()!,
    groups = useAllGroups(viewer.id),
    actions = useLibraryActions(),
    navigate = useNavigate(),
    path = useRouterState({ select: (s) => s.location.pathname });
  const [removing, setRemoving] = useState(false);
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
  // Leaves before the link is gone: the refresh that follows a deletion would otherwise show
  // this editor, or the link's own page, as missing. A failed deletion is reported as a toast.
  const remove = () => {
    actions.remove.mutate({ id: existing.id });
    if (path === "/links/" + existing.id || path === "/l/" + existing.shortId)
      void navigate({ to: "/u/$username", params: { username: viewer.username! }, replace: true });
    else onDone();
  };
  return (
    <>
      <form
        className={"link-form flex flex-col"}
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {/* The dialog's own title names it for assistive technology. */}
        <p
          className={
            "link-form-heading flex items-center min-h-8 pr-10 font-mono text-[11px] uppercase tracking-[0.06em] text-subtle-foreground"
          }
          aria-hidden="true"
        >
          Edit link
        </p>
        <div
          className={
            "link-form-label flex items-center gap-2 mt-4 min-h-7 font-mono text-[11px] uppercase tracking-[0.06em] text-subtle-foreground"
          }
        >
          {existing.category !== "uncategorized" && (
            <>
              <span className={"inline-flex items-center gap-2"}>
                <i
                  className={categoryMarkClassName}
                  data-category={existing.category}
                  aria-hidden="true"
                />
                {existing.category}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <form.Field name="groupId">
            {(field) => (
              <GroupMenu
                value={field.state.value}
                groups={customGroups}
                loading={!groups.complete}
                onChange={(id) => {
                  field.handleChange(id);
                  change("groupId", id);
                }}
              />
            )}
          </form.Field>
        </div>
        <form.Field name="title">
          {(field) => (
            // The size is set here: narrow screens size fields from their parent (see globals.css).
            <Field
              data-invalid={field.state.meta.errors.length > 0}
              className="mt-4.5 gap-3 text-[38px] [@media(width<=700px)]:text-[30px]"
            >
              <FieldLabel className="sr-only" htmlFor="link-title">
                Title
              </FieldLabel>
              {/* The serif's ascenders and descenders reach about 0.134em past its 1.1 line
                  height, which a field clips. Padding holds them; the margin keeps the text in
                  place. */}
              <Textarea
                id="link-title"
                rows={1}
                placeholder="Title"
                className={
                  quietField +
                  " -my-[0.14em] py-[0.14em] text-[length:inherit] font-serif font-bold [font-variation-settings:'opsz'_60] tracking-[-0.015em] leading-[1.1] text-foreground"
                }
                value={field.state.value}
                onBlur={field.handleBlur}
                // A title is one line; Return saves, as in any single-line field.
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }}
                onChange={(e) => {
                  const value = e.target.value.replace(/\s*\n\s*/g, " ");
                  field.handleChange(value);
                  change("title", value);
                }}
              />
              <FieldError className="text-[13px]" errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="url">
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0} className="mt-4 gap-2">
              <FieldLabel className="sr-only" htmlFor="link-url">
                Link
              </FieldLabel>
              <div className={"relative"}>
                <Globe
                  className={
                    "absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-subtle-foreground pointer-events-none"
                  }
                  aria-hidden="true"
                />
                <Input
                  id="link-url"
                  type="url"
                  className={
                    "min-h-10 rounded-[10px] border-dashed border-border bg-transparent py-2 pl-9 pr-3 font-mono text-[13px] text-muted-foreground focus-visible:border-solid focus-visible:bg-background focus-visible:text-foreground"
                  }
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    change("url", e.target.value);
                  }}
                />
              </div>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <Field
              data-invalid={field.state.meta.errors.length > 0}
              className="mt-5.5 gap-2 text-[16px]"
            >
              <FieldLabel className="sr-only" htmlFor="link-note">
                Note
              </FieldLabel>
              <Textarea
                id="link-note"
                className={
                  "min-h-16 max-h-60 rounded-none border-0 border-l-2 border-border bg-transparent py-1 pr-0 pl-3.5 text-[length:inherit] leading-[1.55] focus-visible:border-l-foreground focus-visible:ring-0"
                }
                rows={2}
                placeholder="Anything worth remembering?"
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
        <form.Subscribe selector={(s) => s.values.groupId}>
          {(groupId) => {
            const locked = customGroups.find((g) => g.id === groupId)?.visibility === "private";
            return (
              <p
                className={
                  "link-form-visibility flex items-center gap-2 mt-4 text-[13px] text-subtle-foreground [&_svg]:size-3.5 [&_svg]:flex-none"
                }
              >
                {locked ? <LockKeyhole aria-hidden="true" /> : <Globe aria-hidden="true" />}
                {locked
                  ? "Only you will see this link."
                  : "Visible to everyone who can see your profile."}
              </p>
            );
          }}
        </form.Subscribe>
        <div
          className={
            "link-form-footer flex items-center gap-2 mt-6 pt-4.5 border-t border-border [&_[data-slot='button']]:min-h-9.5 [&_[data-slot='button']]:p-[0_18px] [&_[data-slot='button']]:rounded-full"
          }
        >
          <Button
            type="button"
            variant="ghost"
            className="-ml-4.5 text-destructive hover:text-destructive"
            onClick={() => setRemoving(true)}
          >
            Delete link
          </Button>
          <div className={"modal-actions flex flex-1 items-center justify-end gap-2"}>
            <Button type="button" variant="ghost" className="modal-cancel" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save changes
            </Button>
          </div>
        </div>
      </form>
      <Confirmation
        open={removing}
        onOpenChange={setRemoving}
        title="Delete link?"
        description="This removes the original post, its comments, and saved references."
        destructive
        label="Delete"
        onConfirm={remove}
      />
    </>
  );
}
/** Your groups, and who will see the link in each; "No group" follows your profile. */
function GroupMenu({
  value,
  groups,
  loading,
  onChange,
}: {
  value: string | null;
  groups: Group[];
  loading: boolean;
  onChange: (id: string | null) => void;
}) {
  const chosen = groups.find((g) => g.id === value);
  // Until every page has loaded, a chosen group may not be known by name yet.
  const name = chosen?.name ?? (value && loading ? "Group" : "No group");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className={
              "link-group h-7 gap-1.5 rounded-md px-2 font-mono text-[11px] font-normal uppercase tracking-[0.06em] text-foreground [&_svg:last-child]:text-subtle-foreground [&_svg:last-child]:[transition:transform_150ms_ease] [&[aria-expanded='true']_svg:last-child]:[transform:rotate(180deg)]"
            }
            aria-label={"Group: " + name}
          />
        }
      >
        {chosen?.visibility === "private" && <LockKeyhole className="size-3" aria-hidden="true" />}
        {name}
        <ChevronDown className="size-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value ?? "none"}
          onValueChange={(next) => onChange(next === "none" ? null : String(next))}
        >
          <DropdownMenuRadioItem value="none">No group</DropdownMenuRadioItem>
          {groups.map((g) => (
            <DropdownMenuRadioItem key={g.id} value={g.id}>
              {g.visibility === "private" && <LockKeyhole aria-hidden="true" />}
              {g.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
