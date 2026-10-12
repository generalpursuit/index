import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUp, ArrowUpRight, MoreHorizontal, Reply, Trash } from "lucide-react";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@index/ui/components/dropdown-menu";
import { useViewer } from "@/hooks/use-api";
import { useProfile } from "@/features/profiles/hooks/use-profiles";
import { useLink, useComments } from "./hooks/use-links";
import { LinkActions } from "./link-row";
import { domain } from "./url";
import { QueryState, More } from "@/components/app/query-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { Back } from "@/components/app/navigation";
import { timeAgo } from "@/lib/weeks";
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
      {link.data && <Post id={id} standalone={standalone} comments={comments} />}
    </QueryState>
  );
}
function Post({
  id,
  standalone,
  comments,
}: {
  id: string;
  standalone: boolean;
  comments: ReturnType<typeof useComments>;
}) {
  const link = useLink(id).data!,
    author = useProfile(link.ownerId),
    viewer = useViewer();
  const { list, create, remove } = comments,
    [text, setText] = useState(""),
    input = useRef<HTMLInputElement>(null);
  return (
    <article
      className={
        "post-detail [&_h1]:select-text [&_h1]:font-semibold [&_h1]:tracking-[-0.035em] [&_h1]:leading-[1.1] [&_h1]:text-[36px] [&_h1]:m-[0_0_24px] [&_h1]:wrap-anywhere [&_small]:text-subtle-foreground flex flex-col min-h-[70dvh] [@media(width<=700px)]:[&_h1]:text-[32px]"
      }
    >
      <header
        className={
          "post-author flex items-center gap-3 pr-6 mb-7.5 text-[13px] [&_.user-avatar]:w-7.5 [&_.user-avatar]:h-7.5"
        }
      >
        {standalone && <Back />}
        {author.data && (
          <Link
            to="/u/$username"
            params={{ username: author.data.username! }}
            className={"person-inline flex items-center gap-3 min-w-0 [&_strong]:font-medium"}
          >
            <UserAvatar person={author.data} />
            <strong>{author.data.username ?? author.data.name}</strong>
          </Link>
        )}
        <small>{timeAgo(link.createdAt)}</small>
      </header>
      <h1>{link.title}</h1>
      <div
        className={
          "post-meta [&>a]:select-text [&>a]:flex [&>a]:items-center [&>a]:gap-1.5 flex items-center justify-between text-muted-foreground mb-6"
        }
      >
        <a href={link.url} target="_blank" rel="noreferrer">
          {domain(link.url)} <ArrowUpRight size={16} />
        </a>
        <LinkActions link={link} />
      </div>
      {link.description && (
        <p
          className={
            "post-description select-text whitespace-pre-wrap wrap-anywhere mb-6 max-h-[20dvh] overflow-auto"
          }
        >
          {link.description}
        </p>
      )}
      <div
        className={
          "comments border-t border-t-border pt-6 min-h-0 overflow-auto flex-1 [&_h2]:text-[14px] [&_h2]:mb-5"
        }
      >
        <h2>Comments</h2>
        <QueryState
          pending={list.isPending}
          hasData={!!list.data}
          error={list.error}
          retry={() => void list.refetch()}
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
                <Link to="/u/$username" params={{ username: c.author.username! }}>
                  <UserAvatar person={c.author} />
                </Link>
                <div
                  className={
                    "comment-body [&_p]:select-text [&_p]:whitespace-pre-wrap [&_p]:wrap-anywhere [&_p]:mt-1.5 [&_p]:text-foreground [&_header]:flex [&_header]:items-center [&_header]:gap-2 [&_header]:text-[13px] [&_small]:text-[11px] flex-1 min-w-0"
                  }
                >
                  <header>
                    <Link to="/u/$username" params={{ username: c.author.username! }}>
                      {c.author.username ?? c.author.name}
                    </Link>
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
          className={"composer flex gap-2.5 items-center pt-4"}
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim())
              create.mutate({ linkId: id, body: text }, { onSuccess: () => setText("") });
          }}
        >
          <Input
            variant="composer"
            ref={input}
            disabled={create.isPending}
            aria-label="Comment"
            placeholder="Comment"
            maxLength={5000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            type="submit"
            size="icon"
            className="size-10 flex-none"
            aria-label="Post comment"
            disabled={!text.trim() || create.isPending}
          >
            <ArrowUp />
          </Button>
        </form>
      ) : (
        <Link to="/login" className="sign-in-link">
          Sign in to join the conversation
        </Link>
      )}
    </article>
  );
}
