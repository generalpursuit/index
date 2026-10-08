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
import { LinkActions, domain } from "./link-row";
import { QueryState, UserAvatar, More, Back } from "@/components/app/primitives";
import { timeAgo } from "@/lib/weeks";
export function LinkDetail({ id, standalone = false }: { id: string; standalone?: boolean }) {
  const link = useLink(id);
  return (
    <QueryState pending={link.isPending} error={link.error} retry={() => void link.refetch()}>
      {link.data && <Post id={id} standalone={standalone} />}
    </QueryState>
  );
}
function Post({ id, standalone }: { id: string; standalone: boolean }) {
  const link = useLink(id).data!,
    author = useProfile(link.ownerId),
    viewer = useViewer();
  const { list, create, remove } = useComments(id),
    [text, setText] = useState(""),
    input = useRef<HTMLInputElement>(null);
  return (
    <article className="post-detail">
      <header className="post-author">
        {standalone && <Back />}
        {author.data && (
          <Link to="/people/$userId" params={{ userId: link.ownerId }} className="person-inline">
            <UserAvatar person={author.data} />
            <strong>{author.data.username ?? author.data.name}</strong>
          </Link>
        )}
        <small>{timeAgo(link.createdAt)}</small>
      </header>
      <h1>{link.title}</h1>
      <div className="post-meta">
        <a href={link.url} target="_blank" rel="noreferrer">
          {domain(link.url)} <ArrowUpRight size={16} />
        </a>
        <LinkActions link={link} />
      </div>
      {link.description && <p className="post-description">{link.description}</p>}
      <div className="comments">
        <h2>Comments</h2>
        <QueryState pending={list.isPending} error={list.error} retry={() => void list.refetch()}>
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((c) => (
              <article className="comment" key={c.id}>
                <Link to="/people/$userId" params={{ userId: c.author.id }}>
                  <UserAvatar person={c.author} />
                </Link>
                <div className="comment-body">
                  <header>
                    <Link to="/people/$userId" params={{ userId: c.author.id }}>
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
          {list.data?.pages[0]?.items.length === 0 && <p className="muted">No comments yet.</p>}
          <More
            hasNext={list.hasNextPage}
            isFetching={list.isFetchingNextPage}
            fetch={list.fetchNextPage}
          />
        </QueryState>
      </div>
      {viewer ? (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim())
              create.mutate({ linkId: id, body: text }, { onSuccess: () => setText("") });
          }}
        >
          <Input
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
