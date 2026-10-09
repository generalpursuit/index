import { useId, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useLibraryActions } from "./hooks/use-links";
import { domain, webURL } from "./link-row";
import type { SavedLink } from "@/lib/types";

type Pending = { url: string; existing: Set<string> };

/**
 * A list row that is also a field: pasting a link (or typing one and pressing Enter) saves it
 * right away, and the server reads its title and category from the page. The full composer
 * stays behind the menu's "+". `links` is the list shown below, used to hand over seamlessly.
 */
export function QuickAdd({
  groupId,
  links,
  label,
}: {
  groupId?: string;
  links: SavedLink[];
  label: string;
}) {
  const { create, remove } = useLibraryActions();
  const hintId = useId();
  const [text, setText] = useState("");
  const [hint, setHint] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const save = async (url: string) => {
    const entry: Pending = { url, existing: new Set(links.map((link) => link.id)) };
    setText("");
    setHint(false);
    setPending((old) => [entry, ...old]);
    try {
      const link = await create.mutateAsync({ url, groupId: groupId ?? null });
      setAnnouncement("Added " + link.title);
      toast.success("Link added", {
        action: { label: "Undo", onClick: () => remove.mutate({ id: link.id }) },
      });
    } catch {
      // Keep the link in the field so saving can be retried.
      setText(url);
    } finally {
      setPending((old) => old.filter((other) => other !== entry));
    }
  };
  // The refreshed list arrives a moment before the save resolves. Hiding a pending row as soon
  // as its link is listed keeps both from showing at once, which made the rows below jump.
  const waiting = pending.filter(
    (entry) => !links.some((link) => link.url === entry.url && !entry.existing.has(link.id)),
  );
  return (
    <>
      <div className="quick-add">
        {/* An empty marker: it takes its color once the page says what the link is. */}
        <i className="category-mark" data-empty aria-hidden="true" />
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          placeholder="Enter a link"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(false);
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
              e.currentTarget.blur();
            } else if (e.key === "Enter") {
              e.preventDefault();
              const url = text.trim();
              if (webURL(url)) void save(url);
              else if (url) setHint(true);
            }
          }}
        />
      </div>
      {hint && (
        <p className="quick-add-hint" id={hintId}>
          Enter a web link (https://…)
        </p>
      )}
      {waiting.map(({ url }, index) => (
        <div className="link-row" key={url + index} aria-hidden="true">
          <i className="category-mark" data-empty />
          <span className="link-open" data-pending>
            Fetching title…
          </span>
          <span className="link-domain">
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
