import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@index/ui/components/input";
import { Textarea } from "@index/ui/components/textarea";
import { Button } from "@index/ui/components/button";
import { Field, FieldLabel, FieldError } from "@index/ui/components/field";
import { createLinkInputSchema } from "@index/api/features/links/schemas";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { categorize } from "@index/api/features/links/categories";
import { toast } from "sonner";
import { QueryState, More } from "@/components/app/primitives";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useDebounced } from "@/hooks/use-debounced";
import { useDraft } from "@/hooks/use-draft";
import { useGroups, useLibraryActions } from "./hooks/use-links";
import { domain, webURL } from "./link-row";
import type { SavedLink } from "@/lib/types";
type Draft = {
  url: string;
  title: string;
  description: string;
  groupId: string | null;
};
/** Adds a new link, or edits one when `edit` is given; calls `onDone` after saving. */
export function LinkComposer({
  group,
  edit,
  onDone,
}: {
  group?: string;
  edit?: string;
  onDone: () => void;
}) {
  const api = useAPI(),
    existing = useQuery(
      api.links.get.queryOptions({
        input: { id: edit ?? "00000000-0000-4000-8000-000000000000" },
        enabled: !!edit,
      }),
    );
  if (edit)
    return (
      <QueryState
        pending={existing.isPending}
        error={existing.error}
        retry={() => void existing.refetch()}
      >
        {existing.data && <LinkForm key={edit} existing={existing.data} onDone={onDone} />}
      </QueryState>
    );
  return <LinkForm key={group ?? ""} group={group} onDone={onDone} />;
}
function LinkForm({
  group,
  existing,
  onDone,
}: {
  group?: string;
  existing?: SavedLink;
  onDone: () => void;
}) {
  const viewer = useViewer()!,
    groups = useGroups(viewer.id),
    actions = useLibraryActions();
  const [draft, setDraft] = useDraft<Draft>(
    "link:" + (existing?.id ?? "new:" + group),
    existing
      ? {
          url: existing.url,
          title: existing.title,
          description: existing.description ?? "",
          groupId: existing.groupId,
        }
      : {
          url: "",
          title: "",
          description: "",
          groupId: group ?? null,
        },
  );
  const form = useForm({
    defaultValues: draft,
    validators: {
      onSubmit: createLinkInputSchema.extend({
        title: z.string().trim().max(500),
        description: createLinkInputSchema.shape.description.unwrap().unwrap(),
        groupId: createLinkInputSchema.shape.groupId.unwrap(),
      }),
    },
    onSubmit: async ({ value }) => {
      // An empty title lets the server use the page's own.
      const { url, title, description, groupId } = value;
      const link = { url, title: title.trim() || undefined, description, groupId };
      try {
        if (existing) await actions.update.mutateAsync({ ...link, id: existing.id });
        else await actions.create.mutateAsync(link);
        setDraft({
          url: "",
          title: "",
          description: "",
          groupId: group ?? null,
        });
        toast.success(existing ? "Link saved" : "Link added");
        onDone();
      } catch {
        /* Mutation errors are shown by the query client; keep the draft. */
      }
    },
  });
  // Read the page once the URL settles; its title fills in unless you wrote your own.
  const api = useAPI();
  const titleEdited = useRef(!!existing);
  const [url, setUrl] = useState(draft.url);
  const settledUrl = useDebounced(url.trim(), 300);
  const preview = useQuery(
    api.links.preview.queryOptions({
      input: { url: settledUrl },
      enabled: webURL(settledUrl) && settledUrl !== existing?.url,
      staleTime: Infinity,
      retry: false,
    }),
  );
  useEffect(() => {
    const title = preview.data?.title;
    if (!title || titleEdited.current || form.state.values.title === title) return;
    form.setFieldValue("title", title);
    setDraft({ ...form.state.values, title });
  }, [preview.data, form, setDraft]);
  const fetchingTitle = preview.isFetching && !titleEdited.current;
  const saving = actions.create.isPending || actions.update.isPending;
  const customGroups =
    groups.data?.pages.flatMap((p) => p.items).filter((g) => g.kind === "custom") ?? [];
  const change = (name: keyof Draft, value: string | null) =>
    setDraft({ ...form.state.values, [name]: value });
  return (
    <form
      className="link-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="url">
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel className="sr-only" htmlFor="link-url">
              URL
            </FieldLabel>
            <Input
              id="link-url"
              className="link-url"
              type="url"
              autoFocus={!existing}
              placeholder="Paste a link"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => {
                field.handleChange(e.target.value);
                change("url", e.target.value);
                setUrl(e.target.value);
              }}
              // Pasting is the main way in, so it hands over to the title right away.
              onPaste={() =>
                setTimeout(() => {
                  if (webURL(form.state.values.url)) document.getElementById("link-title")?.focus();
                })
              }
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values}>
        {(values) =>
          (existing || webURL(values.url)) && (
            <div className="link-form-details">
              <section className="link-preview" aria-label="Preview">
                <span className="link-form-label">Preview</span>
                <div className="link-row">
                  <i
                    className="category-mark"
                    data-category={preview.data?.category ?? categorize(values.url.trim())}
                    aria-hidden="true"
                  />
                  <span className="link-open" data-pending={fetchingTitle || undefined}>
                    {values.title.trim() ||
                      (fetchingTitle ? "Fetching title…" : domain(values.url.trim()))}
                  </span>
                  <span className="link-domain">
                    <span>{domain(values.url.trim())}</span>
                    <ArrowUpRight aria-hidden="true" />
                  </span>
                </div>
              </section>
              <form.Field name="title">
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel className="link-form-label" htmlFor="link-title">
                      Title
                    </FieldLabel>
                    <Input
                      id="link-title"
                      placeholder={fetchingTitle ? "Fetching title…" : "From the page"}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        // Clearing the title hands it back to the page.
                        titleEdited.current = e.target.value !== "";
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
                    <FieldLabel className="link-form-label" htmlFor="link-note">
                      Note
                    </FieldLabel>
                    <Textarea
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
                    <div className="link-form-group">
                      <span className="link-form-label" id="link-group-label">
                        Group
                      </span>
                      <div
                        className="link-group-choices"
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
                            {g.visibility === "private" && (
                              <LockKeyhole size={12} aria-hidden="true" />
                            )}
                            {g.name}
                          </button>
                        ))}
                        <More
                          hasNext={groups.hasNextPage}
                          isFetching={groups.isFetchingNextPage}
                          fetch={groups.fetchNextPage}
                        />
                      </div>
                      <p className="muted">
                        {chosen?.visibility === "private"
                          ? "Only you will see this link."
                          : "Visible to everyone who can see your profile."}
                      </p>
                    </div>
                  );
                }}
              </form.Field>
              <div className="modal-actions">
                <Button type="button" variant="ghost" className="modal-cancel" onClick={onDone}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {existing ? "Save changes" : "Add link"}
                </Button>
              </div>
            </div>
          )
        }
      </form.Subscribe>
    </form>
  );
}
