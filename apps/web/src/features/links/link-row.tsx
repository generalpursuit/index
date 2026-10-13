import { preparePost } from "./queries";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { useAPI } from "@/hooks/use-api";
import type { SavedLink } from "@/lib/types";
import { categoryMarkClassName } from "./category-mark";
import { domain } from "./url";
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
        className={categoryMarkClassName}
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
          void navigate({ to: ".", search: (old) => ({ ...old, post: link.shortId }) });
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
