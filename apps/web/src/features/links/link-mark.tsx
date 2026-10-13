import type { ReactNode } from "react";
import { Heart, Star } from "lucide-react";
import { useMediaQuery } from "@index/ui/hooks/use-media-query";
import { useViewer } from "@/hooks/use-api";
import type { SavedLink } from "@/lib/types";
import { categoryColorClassName, categoryMarkClassName } from "./category-mark";
import { useCollect, useKept } from "./hooks/use-links";

// The square and its symbol share one cell and fade between each other.
const markClassName =
  "link-mark self-stretch grid place-items-center [&>*]:[grid-area:1/1] [&>*]:[transition:opacity_150ms_ease,fill_150ms_ease] [&>svg]:size-3 [&>svg]:text-[var(--category-color)] [&>svg]:fill-transparent [&>svg]:opacity-0 [&[data-kept]>svg]:opacity-100 [&[data-kept]>svg]:fill-current [&[data-kept]>.category-mark]:opacity-0 " +
  categoryColorClassName;

/**
 * A link's category square, which becomes a heart in its color for your own links you favorite
 * and a star for other people's you star. With `toggle`, a signed-in mouse or trackpad keeps the
 * link from here (lists only hold links you can see): hovering or focusing shows the outline.
 * Touch screens only show the state, so a stray tap keeps nothing; the post's heart is the way.
 */
export function LinkMark({ link, toggle = false }: { link: SavedLink; toggle?: boolean }) {
  const viewer = useViewer(),
    own = viewer?.id === link.ownerId,
    { kept, changing } = useKept(link, own),
    hover = useMediaQuery("(hover: hover) and (pointer: fine)");
  const Icon = own ? Heart : Star;
  const content = (
    <>
      <i className={categoryMarkClassName} data-category={link.category} />
      <Icon aria-hidden="true" />
    </>
  );
  if (toggle && viewer && hover)
    return (
      <KeepButton link={link} own={own} kept={kept} changing={changing}>
        {content}
      </KeepButton>
    );
  return (
    <span
      className={markClassName}
      data-category={link.category}
      data-kept={kept || undefined}
      // The color carries the category; its name shows on hover.
      title={link.category[0]!.toUpperCase() + link.category.slice(1)}
      {...(kept
        ? { role: "img", "aria-label": own ? "Favorite" : "Starred" }
        : { "aria-hidden": true })}
    >
      {content}
    </span>
  );
}
function KeepButton({
  link,
  own,
  kept,
  changing,
  children,
}: {
  link: SavedLink;
  own: boolean;
  kept: boolean;
  changing: boolean;
  children: ReactNode;
}) {
  const collect = useCollect();
  return (
    <button
      type="button"
      className={
        markClassName +
        " rounded-[6px] focus-visible:outline-offset-[-2px] [&:is(:hover,:focus-visible)>svg]:opacity-100 [&:is(:hover,:focus-visible)>.category-mark]:opacity-0"
      }
      data-category={link.category}
      data-kept={kept || undefined}
      aria-label={(own ? "Favorite " : "Star ") + link.title}
      aria-pressed={kept}
      // Not disabled while a change is on its way, which would drop keyboard focus; the next
      // change waits for this one's result.
      onClick={() => !changing && collect.mutate({ link, own })}
    >
      {children}
    </button>
  );
}
