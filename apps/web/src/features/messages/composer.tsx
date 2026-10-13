import { useLayoutEffect, type RefObject } from "react";
import { ArrowUp, Link2, X } from "lucide-react";
import { Button } from "@index/ui/components/button";
import { IconButton } from "@index/ui/components/icon-button";
import { domain } from "@/features/links/url";
import type { MessageDraft } from "./draft";

type Snapshot = ReturnType<MessageDraft["getSnapshot"]>;

const chipClassName =
  "flex items-center gap-2.5 min-h-9 p-[2px_2px_2px_10px] rounded-[14px] bg-surface text-[13px] [&>svg]:flex-none [&>svg]:size-4 [&>svg]:text-subtle-foreground [&>span]:flex-1 [&>span]:min-w-0 [&>span]:truncate [&_small]:text-[12px] [&_small]:text-subtle-foreground [&_button]:size-7 [&_button]:text-subtle-foreground";

/** One rounded field: what the message carries, then the text and its send button. */
export function Composer({
  draft,
  owner,
  input,
  onSend,
}: {
  draft: Snapshot;
  owner: MessageDraft;
  input: RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
}) {
  const sending = draft.status === "sending",
    locked = sending || draft.status === "uncertain";
  // Grow with the text up to the field's maximum height, then scroll.
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = field.scrollHeight + "px";
  }, [draft.body, input]);
  return (
    <form
      className={
        "composer flex flex-col gap-1.5 mt-3 p-1.5 border border-border rounded-[22px] bg-background [transition:border-color_150ms_ease] focus-within:border-input"
      }
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      {draft.attachment && (
        <div className={"draft-attachment " + chipClassName}>
          <Link2 />
          <span>
            <strong className="font-medium">{draft.attachment.title}</strong>{" "}
            <small>· {domain(draft.attachment.url)}</small>
          </span>
          <IconButton
            label="Remove attachment"
            disabled={locked}
            onClick={() => owner.removeAttachment()}
          >
            <X />
          </IconButton>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          ref={input}
          rows={1}
          disabled={locked}
          aria-label="Message"
          placeholder="Message"
          enterKeyHint="send"
          maxLength={10000}
          className={
            "flex-1 min-w-0 max-h-40 p-[6px_4px_6px_10px] bg-transparent leading-5 resize-none outline-none placeholder:text-muted-foreground disabled:opacity-50"
          }
          value={draft.body}
          onChange={(e) => owner.editBody(e.target.value)}
          onKeyDown={(e) => {
            // Safari ends IME composition before this Enter, reporting it only as key 229.
            const composing = e.nativeEvent.isComposing || e.keyCode === 229;
            if (e.key === "Enter" && !e.shiftKey && !composing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          className="flex-none"
          aria-label="Send message"
          disabled={sending || (!draft.body.trim() && !draft.attachment)}
        >
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}
