import { useId, useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { DestinationMenu, useDestination } from "@/features/sharing/destination-menu";
import { useShareSave } from "@/features/sharing/use-share-save";
import { accountGeneration, assertCurrentAccount } from "@/lib/account-boundary";
import { dayLabel, monday } from "@/lib/weeks";
import { useMediaQuery } from "@index/ui/hooks/use-media-query";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useLibraryActions } from "./hooks/use-links";
import { categoryMarkClassName } from "./category-mark";
import { domain, webURL } from "./url";
import type { SavedLink } from "@/lib/types";

type Pending = { url: string; existing: Set<string> };
const hintClassName = "quick-add-hint m-[-4px_0_8px_44px] text-[12px]";

/**
 * A list row that is also a field: pasting a link (or typing one and pressing Enter) saves it
 * right away, and the server reads its title and category from the page. It is the only way
 * to add a link; details are edited afterwards. `links` is the list shown below, used to hand
 * over seamlessly. A link saved before stays in the field with a note under it, and Enter then
 * saves it again.
 */
export function QuickAdd({
  groupId,
  links,
  label,
  compact = false,
  canCreateGroup = true,
  onSave,
  onViewExisting,
}: {
  /** Where saving starts: the group being viewed, otherwise Your links. */
  groupId?: string;
  links: SavedLink[];
  label: string;
  /** Shorter rows with desktop text, for narrow surfaces that are not phones. */
  compact?: boolean;
  /** Offers New group… in the destination menu. */
  canCreateGroup?: boolean;
  /** Called as a save starts, before the server has read the page. */
  onSave?: () => void;
  onViewExisting?: (link: SavedLink) => Promise<void>;
}) {
  const { remove } = useLibraryActions();
  const share = useShareSave(),
    navigate = useNavigate(),
    destination = useDestination(groupId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [duplicate, setDuplicate] = useState<SavedLink | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = useRef(false),
    active = useRef(true);
  const successToast = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const hintId = useId();
  const [text, setText] = useState("");
  const [hint, setHint] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [announcement, setAnnouncement] = useState("");
  // Disabled while saving, the field loses focus. A link handed back to it (already saved, or
  // not sent) brings focus back for the Enter that answers, unless focus has moved elsewhere.
  const refocus = useRef(false);
  useEffect(() => {
    if (share.pending || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement === document.body) inputRef.current?.focus();
  });
  /** `again` is the earlier save of `url` when this is an explicit Save again. */
  const save = async (url: string, again: SavedLink | null = null) => {
    if (busy.current || destination.blocked) return;
    busy.current = true;
    if (successToast.current !== undefined) toast.dismiss(successToast.current);
    const generation = accountGeneration(),
      focused = document.activeElement === inputRef.current;
    setFailure(null);
    const entry: Pending = { url, existing: new Set(links.map((link) => link.id)) };
    setText("");
    setHint(false);
    setDuplicate(null);
    setPending((old) => [entry, ...old]);
    onSave?.();
    const target = destination.current;
    try {
      const result = await share.save(url, target?.id ?? null, !!again);
      assertCurrentAccount(generation);
      if (!active.current) return;
      if (result.status === "existing") {
        setDuplicate(result.link);
        setText(url);
        refocus.current = focused;
        return;
      }
      const link = result.link;
      setAnnouncement("Added " + link.title);
      // Named, because the link may land outside the list being viewed.
      successToast.current = toast.success("Link added to " + (target?.name ?? "Your links"), {
        action: {
          label: "Undo",
          onClick: () => {
            if (generation === accountGeneration()) remove.mutate({ id: link.id });
          },
        },
      });
    } catch (error) {
      if (generation !== accountGeneration() || !active.current) return;
      setText(url);
      refocus.current = focused;
      // Still a Save again, so that retrying repeats the same request.
      setDuplicate(again);
      setFailure(error instanceof Error ? error.message : "Could not save. Try again.");
    } finally {
      busy.current = false;
      if (active.current) setPending((old) => old.filter((other) => other !== entry));
    }
  };
  // The refreshed list arrives a moment before the save resolves. Hiding a pending row as soon
  // as its link is listed keeps both from showing at once, which made the rows below jump.
  const waiting = pending.filter(
    (entry) => !links.some((link) => link.url === entry.url && !entry.existing.has(link.id)),
  );
  const viewExisting = (link: SavedLink) => {
    if (onViewExisting)
      void onViewExisting(link).catch(() =>
        toast.error("Could not open this Index destination. Try again."),
      );
    else void navigate({ to: "/l/$shortId", params: { shortId: link.shortId } });
  };
  return (
    <>
      <div
        className={
          "quick-add grid grid-cols-[32px_minmax(0,_1fr)_auto] items-center gap-x-3 text-subtle-foreground [&_input]:min-w-0 [&_input]:border-0 [&_input]:[outline:none] [&_input]:bg-transparent [&_input]:text-[14px] [&_input]:text-foreground [&:hover_.category-mark]:[box-shadow:inset_0_0_0_1px_var(--ring)] [&:focus-within_.category-mark]:[box-shadow:inset_0_0_0_1px_var(--ring)] [&_input::placeholder]:text-subtle-foreground " +
          (compact
            ? "min-h-8.5 [&_input]:h-8.5"
            : "min-h-12 [&_input]:h-12 [@media(width<=700px)]:min-h-11.5 [@media(width<=700px)]:gap-x-3 [@media(width<=700px)]:text-[13px] [@media(width<=700px)]:[&_input]:text-[16px]")
        }
      >
        {/* An empty marker: it takes its color once the page says what the link is. */}
        <i className={categoryMarkClassName} data-empty aria-hidden="true" />
        <input
          ref={inputRef}
          disabled={share.pending || destination.blocked}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          aria-describedby={hint || duplicate ? hintId : undefined}
          placeholder="Enter a link"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(false);
            setDuplicate(null);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").trim();
            if (text.trim() || !webURL(pasted)) return;
            e.preventDefault();
            void save(pasted);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setText("");
              setHint(false);
              setDuplicate(null);
              e.currentTarget.blur();
            } else if (e.key === "Enter") {
              e.preventDefault();
              const url = text.trim();
              if (webURL(url)) void save(url, duplicate);
              else if (url) setHint(true);
            }
          }}
        />
        <DestinationMenu
          destination={destination}
          disabled={share.pending}
          canCreateGroup={canCreateGroup}
        />
      </div>
      {destination.unavailable && (
        <p role="alert" className="ml-11 text-sm text-destructive">
          This group is unavailable. Choose a destination before saving.
        </p>
      )}
      {failure && (
        <p role="alert" className="ml-11 text-sm text-destructive">
          {failure}
        </p>
      )}
      {hint && (
        <p className={hintClassName + " text-destructive"} id={hintId}>
          Enter a web link (https://…)
        </p>
      )}
      {duplicate && (
        <AlreadySaved
          id={hintId}
          link={duplicate}
          disabled={share.pending || destination.blocked}
          onSaveAgain={() => void save(text.trim(), duplicate)}
          onView={() => viewExisting(duplicate)}
        />
      )}
      {waiting.map(({ url }, index) => (
        <div
          className={
            "link-row [&_small]:text-subtle-foreground [--mark-column:32px] grid grid-cols-[var(--mark-column)_minmax(0,_1fr)_auto] items-center gap-x-3 min-w-0 " +
            (compact
              ? "min-h-8.5 pr-2"
              : "min-h-12 [@media(width<=700px)]:min-h-11.5 [@media(width<=700px)]:gap-x-3")
          }
          key={url + index}
          aria-hidden="true"
        >
          <i className={categoryMarkClassName} data-empty />
          <span
            className={
              "link-open self-stretch min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[14px] text-foreground [&:hover]:underline [&:hover]:decoration-subtle-foreground [&:hover]:underline-offset-[4px] [span&]:self-center [&[data-pending]]:text-subtle-foreground [&[data-pending]]:[animation:loading-pulse_1.5s_ease-in-out_infinite] [@media(width<=700px)]:text-[13px]"
            }
            data-pending
          >
            Fetching title…
          </span>
          <span
            className={
              "link-domain inline-flex items-center gap-1 min-w-0 max-w-55 text-[12px] text-subtle-foreground [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap [&_svg]:flex-none [&_svg]:w-3 [&_svg]:h-3 [&:hover]:text-foreground [@media(width<=700px)]:max-w-30 [@media(width<=700px)]:text-[11px]"
            }
          >
            <span>{domain(url)}</span>
            <ArrowUpRight />
          </span>
        </div>
      ))}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

/**
 * One quiet line under the field for a link saved before. Saving again adds another original to
 * the destination in the row; the earlier save stays where it is.
 */
function AlreadySaved({
  id,
  link,
  disabled,
  onSaveAgain,
  onView,
}: {
  id: string;
  link: SavedLink;
  disabled: boolean;
  onSaveAgain: () => void;
  onView: () => void;
}) {
  // Touch keyboards may have no Return key to point at, so the action itself is offered.
  const touch = useMediaQuery("(pointer: coarse)");
  const saved =
    monday(new Date(link.savedOn)) === monday()
      ? "Already saved this week"
      : "Saved on " + dayLabel(link.savedOn);
  const action =
    "relative text-foreground underline-offset-[3px] after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] enabled:hover:underline disabled:opacity-50";
  return (
    <p id={id} role="status" className={hintClassName + " text-subtle-foreground"}>
      {saved}
      {touch ? (
        " · "
      ) : (
        <>
          . <kbd aria-hidden="true">↵</kbd>
          <span className="sr-only">Enter</span> to{" "}
        </>
      )}
      <button type="button" className={action} disabled={disabled} onClick={onSaveAgain}>
        {touch ? "Save again" : "save again"}
      </button>
      {" · "}
      <button type="button" className={action} onClick={onView}>
        View
      </button>
    </p>
  );
}
