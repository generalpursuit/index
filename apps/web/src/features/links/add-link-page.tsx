import { useEffect, useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@index/ui/components/input";
import { Textarea } from "@index/ui/components/textarea";
import { Button } from "@index/ui/components/button";
import { Field, FieldLabel, FieldError } from "@index/ui/components/field";
import { createLinkInputSchema } from "@index/api/features/links/schemas";
import { Heading, Choice, QueryState, More } from "@/components/app/primitives";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useDraft } from "@/hooks/use-draft";
import { useBack } from "@/hooks/use-back";
import { useGroups, useLibraryActions } from "./hooks/use-links";
import { monday, weekLabel } from "@/lib/weeks";
import type { SavedLink } from "@/lib/types";
type Draft = {
  url: string;
  title: string;
  description: string;
  category: SavedLink["category"];
  groupId: string | null;
  savedOn: string;
};
export function AddLinkPage({
  week = monday(),
  group,
  edit,
}: {
  week?: string;
  group?: string;
  edit?: string;
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
        {existing.data && <LinkForm key={edit} week={week} existing={existing.data} />}
      </QueryState>
    );
  return <LinkForm key={week + (group ?? "")} week={week} group={group} />;
}
function LinkForm({
  week,
  group,
  existing,
}: {
  week: string;
  group?: string;
  existing?: SavedLink;
}) {
  const viewer = useViewer()!,
    api = useAPI(),
    back = useBack(),
    groups = useGroups(viewer.id),
    actions = useLibraryActions();
  const [draft, setDraft] = useDraft<Draft>(
    "link:" + (existing?.id ?? week + ":" + group),
    existing
      ? {
          url: existing.url,
          title: existing.title,
          description: existing.description ?? "",
          category: existing.category,
          groupId: existing.groupId,
          savedOn: existing.savedOn,
        }
      : {
          url: "",
          title: "",
          description: "",
          category: "uncategorized",
          groupId: group ?? null,
          savedOn: week === monday() ? new Date().toISOString().slice(0, 10) : week,
        },
  );
  const manualCategory = useRef(draft.category !== "uncategorized"),
    suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    latestUrl = useRef(draft.url);
  useEffect(
    () => () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    },
    [],
  );
  const form = useForm({
    defaultValues: draft,
    validators: {
      onSubmit: createLinkInputSchema.extend({
        description: createLinkInputSchema.shape.description.unwrap().unwrap(),
        category: createLinkInputSchema.shape.category.removeDefault(),
        groupId: createLinkInputSchema.shape.groupId.unwrap(),
        savedOn: createLinkInputSchema.shape.savedOn.unwrap(),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        if (existing) await actions.update.mutateAsync({ ...value, id: existing.id });
        else await actions.create.mutateAsync(value);
        setDraft({
          url: "",
          title: "",
          description: "",
          category: "uncategorized",
          groupId: group ?? null,
          savedOn: draft.savedOn,
        });
        back();
      } catch {
        /* Mutation errors are shown by the query client; keep the draft. */
      }
    },
  });
  function suggest(url: string) {
    latestUrl.current = url;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (manualCategory.current || !URL.canParse(url)) return;
    suggestTimer.current = setTimeout(() => {
      void api.categories.suggest.call({ url }).then(
        (result) => {
          if (latestUrl.current === url && !manualCategory.current) {
            form.setFieldValue("category", result.category);
            setDraft({ ...form.state.values, category: result.category });
          }
        },
        () => {
          /* Suggestions are optional; manual input remains available. */
        },
      );
    }, 350);
  }
  return (
    <div className="add-page">
      <Heading back>{existing ? "Edit link" : "Add link"}</Heading>
      <p className="muted">{weekLabel(monday(new Date(draft.savedOn + "T00:00:00Z")))}</p>
      <form
        className="ghost-form"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {(["url", "title", "description"] as const).map((name) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel className="sr-only" htmlFor={"link-" + name}>
                  {name === "url" ? "URL" : name === "title" ? "Title" : "Description"}
                </FieldLabel>
                {name === "description" ? (
                  <Textarea
                    id={"link-" + name}
                    className="ghost-input"
                    placeholder="Description (optional)"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      setDraft({ ...form.state.values, [name]: e.target.value });
                    }}
                  />
                ) : (
                  <Input
                    id={"link-" + name}
                    autoFocus={name === "url"}
                    className={"ghost-input " + (name === "title" ? "title-input" : "")}
                    type={name === "url" ? "url" : "text"}
                    placeholder={name === "url" ? "URL" : "Title"}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      setDraft({ ...form.state.values, [name]: e.target.value });
                      if (name === "url") suggest(e.target.value);
                    }}
                  />
                )}
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        ))}
        <div className="form-options">
          <form.Field name="category">
            {(field) => (
              <Choice
                label="Category"
                value={field.state.value}
                options={[
                  "uncategorized",
                  "article",
                  "podcast",
                  "music",
                  "video",
                  "book",
                  "tool",
                  "note",
                ].map((c) => ({
                  value: c,
                  label: c === "uncategorized" ? "Category" : c[0]!.toUpperCase() + c.slice(1),
                }))}
                onChange={(v) => {
                  manualCategory.current = true;
                  field.handleChange(v as Draft["category"]);
                  setDraft({ ...form.state.values, category: v as Draft["category"] });
                }}
              />
            )}
          </form.Field>
          <form.Field name="groupId">
            {(field) => (
              <Choice
                label="Group"
                value={field.state.value ?? "inbox"}
                onChange={(v) => {
                  field.handleChange(v === "inbox" ? null : v);
                  setDraft({ ...form.state.values, groupId: v === "inbox" ? null : v });
                }}
                options={[
                  { value: "inbox", label: "Inbox" },
                  ...(groups.data?.pages
                    .flatMap((p) => p.items)
                    .filter((g) => g.kind === "custom")
                    .map((g) => ({ value: g.id, label: g.name })) ?? []),
                ]}
              />
            )}
          </form.Field>
          <Button type="submit" disabled={actions.create.isPending || actions.update.isPending}>
            {existing ? "Save" : "Add"}
          </Button>
        </div>
        <More
          hasNext={groups.hasNextPage}
          isFetching={groups.isFetchingNextPage}
          fetch={groups.fetchNextPage}
        />
      </form>
    </div>
  );
}
