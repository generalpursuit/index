import { createContext, Fragment, useContext, useRef, useState } from "react";
import { ProfileLink } from "@/components/app/profile-link";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ArrowUpRight,
  Forward,
  Heart,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Reply,
  Star,
  Trash,
} from "lucide-react";
import { Button, buttonVariants } from "@index/ui/components/button";
import { IconButton } from "@index/ui/components/icon-button";
import { Input } from "@index/ui/components/input";
import { cn } from "@index/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@index/ui/components/dropdown-menu";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useProfile } from "@/features/profiles/hooks/use-profiles";
import { groupOptions } from "@/features/groups/queries";
import { RecipientPicker, prefetchRecipients } from "@/features/messages/recipient-picker";
import { useLink, useComments, useLibraryActions } from "./hooks/use-links";
import { categoryMarkClassName } from "./category-mark";
import { domain } from "./url";
import { QueryState, More } from "@/components/app/query-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { Back } from "@/components/app/navigation";
import { timeAgo } from "@/lib/weeks";
import type { Group, SavedLink } from "@/lib/types";
/** In the post's own dialog, Forward shows the recipients there instead of opening another. */
export const ForwardInPlace = createContext<((link: SavedLink) => void) | undefined>(undefined);
export function LinkDetail({ id, standalone = false }: { id: string; standalone?: boolean }) {
  const link = useLink(id);
  const comments = useComments(id);
  return (
    <QueryState
      pending={link.isPending}
      hasData={!!link.data}
      error={link.error}
      retry={() => void link.refetch()}
    >
      {/* Given the link rather than reading it again: deleting it from its editor, over this
          post in the same dialog, removes it before the dialog has closed. */}
      {link.data && <Post link={link.data} standalone={standalone} comments={comments} />}
    </QueryState>
  );
}
function Post({
  link,
  standalone,
  comments,
}: {
  link: SavedLink;
  standalone: boolean;
  comments: ReturnType<typeof useComments>;
}) {
  const author = useProfile(link.ownerId),
    viewer = useViewer(),
    group = useQuery(groupOptions(useAPI(), link.groupId)).data;
  const { list, create, remove } = comments,
    [text, setText] = useState(""),
    input = useRef<HTMLInputElement>(null);
  return (
    <article
      className={
        "post-detail flex flex-col min-h-0 [&_.post-title]:select-text [&_.post-title]:font-serif [&_.post-title]:font-bold [&_.post-title]:[font-variation-settings:'opsz'_60] [&_.post-title]:tracking-[-0.015em] [&_.post-title]:leading-[1.1] [&_.post-title]:text-[40px] [&_.post-title]:m-[12px_0_0] [&_.post-title]:wrap-anywhere [@media(width<=700px)]:[&_.post-title]:text-[32px] [&_small]:text-subtle-foreground"
      }
    >
      {/* Clear of the dialog's close button, which shares this row. */}
      <div className={"post-top flex items-center gap-2 min-h-8 pr-10"}>
        {standalone && <Back />}
        <PostLabel link={link} group={group} />
      </div>
      <h1 className="post-title">{link.title}</h1>
      <header
        className={
          "post-author flex items-center gap-2 min-h-6 mt-3.5 text-[13px] text-subtle-foreground [&_.user-avatar]:w-5.5 [&_.user-avatar]:h-5.5 [&_[data-slot='avatar-fallback']]:text-[10px]"
        }
      >
        {author.data && (
          <>
            <ProfileLink
              person={author.data}
              className={
                "person-inline flex items-center gap-2 min-w-0 font-medium text-foreground"
              }
            >
              <UserAvatar person={author.data} />
              <span className="truncate">{author.data.username ?? author.data.name}</span>
            </ProfileLink>
            <span aria-hidden="true">·</span>
          </>
        )}
        <time dateTime={link.createdAt}>{timeAgo(link.createdAt)}</time>
      </header>
      {link.description && (
        <p
          className={
            "post-description select-text whitespace-pre-wrap wrap-anywhere mt-5.5 pl-3.5 border-l-2 border-border text-[16px] leading-[1.55] max-h-[20dvh] overflow-auto"
          }
        >
          {link.description}
        </p>
      )}
      <PostActions link={link} group={group} />
      <div
        className={
          "comments border-t border-t-border mt-7 pt-5 min-h-0 overflow-auto [&_h2]:text-[13px] [&_h2]:font-medium [&_h2]:mb-2"
        }
      >
        <h2>Comments</h2>
        <QueryState
          pending={list.isPending}
          hasData={!!list.data}
          error={list.error}
          retry={() => void list.refetch()}
          // The post fits its content, so the usual loading blocks would open it tall and shrink it.
          // One line, like "No comments yet.", lets comments only grow it; hidden for the first
          // 300ms, so a quick load goes straight to them.
          placeholder={
            <p
              className={
                "muted text-subtle-foreground [animation:loading-reveal_1ms_300ms_backwards]"
              }
              role="status"
            >
              Loading comments…
            </p>
          }
        >
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((c) => (
              <article
                className={
                  "comment flex items-start gap-2.5 p-[12px_0] [&_.user-avatar]:w-8 [&_.user-avatar]:h-8"
                }
                key={c.id}
              >
                <ProfileLink person={c.author}>
                  <UserAvatar person={c.author} />
                </ProfileLink>
                <div
                  className={
                    "comment-body [&_p]:select-text [&_p]:whitespace-pre-wrap [&_p]:wrap-anywhere [&_p]:mt-1.5 [&_p]:text-foreground [&_header]:flex [&_header]:items-center [&_header]:gap-2 [&_header]:text-[13px] [&_small]:text-[11px] flex-1 min-w-0"
                  }
                >
                  <header>
                    <ProfileLink person={c.author}>
                      {c.author.username ?? c.author.name}
                    </ProfileLink>
                    <small>{timeAgo(c.createdAt)}</small>
                  </header>
                  <p>{c.body}</p>
                </div>
                {viewer && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={"Actions for comment by " + c.author.name}
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setText("@" + (c.author.username ?? c.author.name) + " ");
                          input.current?.focus();
                        }}
                      >
                        <Reply />
                        Respond
                      </DropdownMenuItem>
                      {(c.authorId === viewer.id || link.ownerId === viewer.id) && (
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ id: c.id })}
                        >
                          <Trash />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </article>
            ))}
          {list.data?.pages[0]?.items.length === 0 && (
            <p className={"muted text-subtle-foreground"}>No comments yet.</p>
          )}
          <More
            hasNext={list.hasNextPage}
            isFetching={list.isFetchingNextPage}
            fetch={list.fetchNextPage}
          />
        </QueryState>
      </div>
      {viewer ? (
        <form
          className={
            "composer flex gap-2.5 items-center pt-4 [&_.user-avatar]:w-8 [&_.user-avatar]:h-8"
          }
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim())
              create.mutate({ linkId: link.id, body: text }, { onSuccess: () => setText("") });
          }}
        >
          <UserAvatar person={viewer} />
          <div className={"relative flex-1 min-w-0"}>
            <Input
              variant="composer"
              className="pr-12"
              ref={input}
              disabled={create.isPending}
              aria-label="Comment"
              placeholder="Add a comment…"
              maxLength={5000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Button
              type="submit"
              size="icon"
              className="absolute top-1.5 right-1.5 size-8.5"
              aria-label="Post comment"
              disabled={!text.trim() || create.isPending}
            >
              <ArrowUp />
            </Button>
          </div>
        </form>
      ) : (
        <Link to="/login" className="sign-in-link pt-4">
          Sign in to join the conversation
        </Link>
      )}
    </article>
  );
}
/**
 * What the link is, where it lives, and whether you keep it: your own links are Favorites
 * (a heart), other people's are starred.
 */
function PostLabel({ link, group }: { link: SavedLink; group?: Group }) {
  const viewer = useViewer(),
    own = viewer?.id === link.ownerId,
    { collect } = useLibraryActions();
  const kept = own ? link.isFavorite : link.isStarred;
  const parts = [
    link.category !== "uncategorized" && (
      <span className={"inline-flex items-center gap-2"}>
        <i className={categoryMarkClassName} data-category={link.category} aria-hidden="true" />
        {link.category}
      </span>
    ),
    group && (
      <span className={"inline-flex items-center gap-1.5 min-w-0"}>
        {group.visibility === "private" && (
          <LockKeyhole className="size-3 flex-none" aria-label="Locked" />
        )}
        <span className="truncate">{group.name}</span>
      </span>
    ),
    viewer && (
      <IconButton
        label={own ? "Favorite" : "Star"}
        size="icon-sm"
        className={
          "-my-1.5 -mx-1.5 text-subtle-foreground aria-pressed:text-foreground disabled:opacity-100"
        }
        aria-pressed={kept}
        // One change at a time: the next one is decided from this one's result.
        disabled={collect.isPending}
        onClick={() => collect.mutate({ link, own })}
      >
        {own ? (
          <Heart className={cn("size-3.5", kept && "fill-current")} />
        ) : (
          <Star className={cn("size-3.5", kept && "fill-current")} />
        )}
      </IconButton>
    ),
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <div
      className={
        "post-label flex items-center gap-2 min-w-0 font-mono text-[11px] uppercase tracking-[0.06em] text-subtle-foreground"
      }
    >
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {part}
        </Fragment>
      ))}
    </div>
  );
}
/** Reading is the main thing to do with a link; sharing and editing sit beside it. */
function PostActions({ link, group }: { link: SavedLink; group?: Group }) {
  const viewer = useViewer(),
    own = viewer?.id === link.ownerId,
    api = useAPI(),
    cache = useQueryClient();
  const [forward, setForward] = useState(false),
    forwardInPlace = useContext(ForwardInPlace);
  // Only links in locked groups stay private to their owner.
  const forwardable = !!viewer && (!link.groupId || group?.visibility === "public");
  const site = domain(link.url);
  return (
    <div className={"post-actions flex items-center gap-2 mt-6"}>
      <a
        className={cn(buttonVariants({ size: "lg" }), "min-w-0 px-4 text-[13.5px]")}
        href={link.url}
        target="_blank"
        rel="noreferrer"
        aria-label={"Open " + site}
      >
        <span className="truncate">{site}</span>
        <ArrowUpRight aria-hidden="true" />
      </a>
      {forwardable && (
        <IconButton
          label="Forward"
          variant="outline"
          size="icon-lg"
          onPointerEnter={() => prefetchRecipients(cache, api, viewer.id)}
          onFocus={() => prefetchRecipients(cache, api, viewer.id)}
          onClick={() => (forwardInPlace ? forwardInPlace(link) : setForward(true))}
        >
          <Forward />
        </IconButton>
      )}
      {own && (
        // The editor takes the post's place in its dialog, and goes back to it.
        <Link
          to="."
          search={(old) => ({ ...old, edit: link.shortId })}
          className={cn(buttonVariants({ variant: "outline", size: "icon-lg" }), "ml-auto")}
          aria-label="Edit"
          title="Edit"
        >
          <Pencil />
        </Link>
      )}
      {forward && <RecipientPicker link={link} onClose={() => setForward(false)} />}
    </div>
  );
}
