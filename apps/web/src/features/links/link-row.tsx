import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearch, useRouterState, Link } from "@tanstack/react-router";
import {
  BookOpen,
  FileText,
  Headphones,
  Music,
  Video,
  Wrench,
  StickyNote,
  Link2,
  MoreHorizontal,
  Heart,
  Star,
  Forward,
  ExternalLink,
  Pencil,
  Trash,
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
const icons = {
  article: FileText,
  podcast: Headphones,
  music: Music,
  video: Video,
  book: BookOpen,
  tool: Wrench,
  note: StickyNote,
  uncategorized: Link2,
};
export function LinkRow({ link }: { link: SavedLink }) {
  const navigate = useNavigate(),
    Icon = icons[link.category];
  return (
    <div className="link-row">
      <Button
        variant="ghost"
        className="link-open"
        onClick={() => void navigate({ to: ".", search: (old) => ({ ...old, post: link.id }) })}
      >
        <Icon aria-hidden="true" />
        <span>
          <strong>{link.title}</strong>
          <small>{domain(link.url)}</small>
        </span>
      </Button>
      <LinkActions link={link} />
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
                disabled={group.data?.visibility !== "public"}
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
              <DropdownMenuItem render={<Link to="/add" search={{ edit: link.id }} />}>
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
