import { preparePost } from "./queries";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearch, useRouterState, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  MoreHorizontal,
  Heart,
  Star,
  Forward,
  ExternalLink,
  Pencil,
  Trash,
  LockKeyhole,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@index/ui/components/dropdown-menu";
import { Button } from "@index/ui/components/button";
import { useViewer, useAPI } from "@/hooks/use-api";
import { useLibraryActions } from "./hooks/use-links";
import { RecipientPicker } from "@/features/messages/recipient-picker";
import { Confirmation } from "@/components/app/primitives";
import type { SavedLink } from "@/lib/types";
export function domain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
/** Only web links can be saved. */
export function webURL(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}
/**
 * `owner` names whose link it is (in Starred, which holds other people's); `locked` marks
 * your own link in a locked group, so what is private shows without filtering.
 */
export function LinkRow({
  link,
  owner,
  locked = false,
}: {
  link: SavedLink;
  owner?: string;
  locked?: boolean;
}) {
  const navigate = useNavigate(),
    cache = useQueryClient(),
    api = useAPI();
  const prepare = () => preparePost(cache, api, link);
  return (
    <div
      className={
        "link-row [&_small]:text-subtle-foreground [--mark-column:32px] grid grid-cols-[var(--mark-column)_minmax(0,_1fr)_auto] items-center gap-x-3 min-w-0 min-h-12 [@media(width<=700px)]:min-h-11.5 [@media(width<=700px)]:gap-x-3"
      }
    >
      {/* The color carries the category; its name shows on hover. */}
      <i
        className={
          "category-mark justify-self-center w-2 h-2 rounded-[2px] bg-category-other [&[data-category='article']]:bg-category-article [&[data-category='video']]:bg-category-video [&[data-category='music']]:bg-category-music [&[data-category='podcast']]:bg-category-podcast [&[data-category='book']]:bg-category-book [&[data-category='tool']]:bg-category-tool [&[data-category='note']]:bg-category-note [&[data-empty]]:bg-transparent [&[data-empty]]:[box-shadow:inset_0_0_0_1px_var(--subtle-foreground)]"
        }
        data-category={link.category}
        title={link.category[0]!.toUpperCase() + link.category.slice(1)}
        aria-hidden="true"
      />
      <button
        type="button"
        className={
          "link-open self-stretch min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[14px] text-foreground [&:hover]:underline [&:hover]:decoration-subtle-foreground [&:hover]:underline-offset-[4px] [span&]:self-center [&[data-pending]]:text-subtle-foreground [&[data-pending]]:[animation:loading-pulse_1.5s_ease-in-out_infinite] [@media(width<=700px)]:text-[13px]"
        }
        onPointerEnter={prepare}
        onFocus={prepare}
        onTouchStart={prepare}
        onClick={() => {
          prepare();
          void navigate({ to: ".", search: (old) => ({ ...old, post: link.id }) });
        }}
      >
        {link.title}
      </button>
      <span className={"link-end inline-flex items-center justify-end gap-2 min-w-0"}>
        {locked && (
          <LockKeyhole
            className={"link-locked flex-none w-3 h-3 text-subtle-foreground"}
            aria-label="Locked"
          />
        )}
        {owner && (
          <span
            className={
              "link-owner flex-none max-w-30 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted-foreground"
            }
          >
            {owner}
          </span>
        )}
        {/* Reading is the main thing to do with a link, so the domain opens it directly. */}
        <a
          className={
            "link-domain inline-flex items-center gap-1 min-w-0 max-w-55 text-[12px] text-subtle-foreground [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap [&_svg]:flex-none [&_svg]:w-3 [&_svg]:h-3 [&:hover]:text-foreground [@media(width<=700px)]:max-w-30 [@media(width<=700px)]:text-[11px]"
          }
          href={link.url}
          target="_blank"
          rel="noreferrer"
        >
          <span>{domain(link.url)}</span>
          <ArrowUpRight aria-hidden="true" />
        </a>
      </span>
    </div>
  );
}
export function LinkActions({ link }: { link: SavedLink }) {
  const navigate = useNavigate(),
    search = useSearch({ strict: false }),
    path = useRouterState({ select: (s) => s.location.pathname });
  const viewer = useViewer(),
    own = viewer?.id === link.ownerId,
    actions = useLibraryActions();
  const api = useAPI(),
    group = useQuery(
      api.groups.get.queryOptions({
        input: { id: link.groupId ?? "00000000-0000-4000-8000-000000000000" },
        enabled: !!link.groupId,
      }),
    );
  const [forward, setForward] = useState(false),
    [remove, setRemove] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label={"Actions for " + link.title} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {viewer ? (
            <>
              <DropdownMenuItem
                disabled={actions.collect.isPending}
                onClick={() => actions.collect.mutate({ link, own })}
              >
                {own ? <Heart /> : <Star />}
                {own
                  ? link.isFavorite
                    ? "Remove from Favorites"
                    : "Add to Favorites"
                  : link.isStarred
                    ? "Unstar"
                    : "Star"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setForward(true)}
                // Only links in locked groups stay private to their owner.
                disabled={!!link.groupId && group.data?.visibility !== "public"}
              >
                <Forward />
                Forward
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem render={<Link to="/login" />}>
              Sign in to save or send
            </DropdownMenuItem>
          )}
          <DropdownMenuItem render={<a href={link.url} target="_blank" rel="noreferrer" />}>
            <ExternalLink />
            Open website
          </DropdownMenuItem>
          {own && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                render={
                  // Editing replaces the open post rather than stacking a second modal.
                  <Link to="." search={(old) => ({ ...old, post: undefined, edit: link.id })} />
                }
              >
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setRemove(true)}>
                <Trash />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {forward && <RecipientPicker link={link} onClose={() => setForward(false)} />}
      <Confirmation
        open={remove}
        onOpenChange={setRemove}
        title="Delete link?"
        description="This removes the original post, its comments, and saved references."
        destructive
        label="Delete"
        pending={actions.remove.isPending}
        onConfirm={() =>
          actions.remove.mutate(
            { id: link.id },
            {
              onSuccess: () => {
                setRemove(false);
                if (search.post === link.id)
                  void navigate({
                    to: ".",
                    search: (old) => ({ ...old, post: undefined }),
                    replace: true,
                  });
                else if (path === "/links/" + link.id)
                  void navigate({
                    to: "/people/$userId",
                    params: { userId: link.ownerId },
                    replace: true,
                  });
              },
            },
          )
        }
      />
    </>
  );
}
