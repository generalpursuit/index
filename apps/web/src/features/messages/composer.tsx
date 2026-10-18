import { useLayoutEffect, useRef, type RefObject } from "react";
import { ArrowUp, Link2, Paperclip, Reply, X } from "lucide-react";
import { maxBodyLength } from "@index/api/features/messages/schemas";
import { Button } from "@index/ui/components/button";
import { IconButton } from "@index/ui/components/icon-button";
import { domain } from "@/features/links/url";
import type { Conversation } from "@/lib/types";
import { ComposerFiles } from "./composer-files";
import { replyExcerpt, replyLabel } from "./conversation-presentation";
import { ready, type MessageDraft } from "./draft";
import { pastedFiles } from "./transfers";

type Snapshot = ReturnType<MessageDraft["getSnapshot"]>;

const chipClassName =
  "flex items-center gap-2.5 min-h-9 p-[2px_2px_2px_10px] rounded-[14px] bg-surface text-[13px] [&>svg]:flex-none [&>svg]:size-4 [&>svg]:text-subtle-foreground [&>span]:flex-1 [&>span]:min-w-0 [&>span]:truncate [&_small]:text-[12px] [&_small]:text-subtle-foreground [&_button]:size-7 [&_button]:text-subtle-foreground";

/** One rounded field: what the message answers and carries, then its text and send button. */
export function Composer({
  chat,
  viewerId,
  draft,
  owner,
  input,
  onSend,
  onAddFiles,
  onRemoveFile,
}: {
  chat: Conversation;
  viewerId: string;
  draft: Snapshot;
  owner: MessageDraft;
  input: RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (localId: string) => void;
}) {
  const sending = draft.status === "sending",
    locked = sending || draft.status === "uncertain";
  const picker = useRef<HTMLInputElement>(null);
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
      {draft.replyTo && (
        <div className={"draft-reply " + chipClassName}>
          <Reply />
          <span>
            <strong className="font-medium">
              {replyLabel(chat, viewerId, viewerId, draft.replyTo.senderId)}
            </strong>{" "}
            <small>{replyExcerpt(draft.replyTo)}</small>
          </span>
          <IconButton label="Cancel reply" disabled={locked} onClick={() => owner.removeReply()}>
            <X />
          </IconButton>
        </div>
      )}
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
      <ComposerFiles files={draft.files} locked={locked} onRemove={onRemoveFile} />
      <div className="flex items-end gap-1.5">
        <IconButton
          label="Attach files"
          className="flex-none text-subtle-foreground"
          disabled={locked}
          onClick={() => picker.current?.click()}
        >
          <Paperclip />
        </IconButton>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            onAddFiles([...(event.target.files ?? [])]);
            // Picking the same file again is a new change.
            event.target.value = "";
          }}
        />
        <textarea
          ref={input}
          rows={1}
          disabled={locked}
          aria-label="Message"
          placeholder="Message"
          maxLength={maxBodyLength}
          className={
            "flex-1 min-w-0 max-h-40 p-[6px_4px_6px_2px] bg-transparent leading-5 resize-none outline-none placeholder:text-muted-foreground disabled:opacity-50"
          }
          value={draft.body}
          onChange={(e) => owner.editBody(e.target.value)}
          onPaste={(event) => {
            // Pasted files are attached; text pastes as usual, even with a picture of itself.
            const files = pastedFiles(event.clipboardData);
            if (!files.length) return;
            event.preventDefault();
            onAddFiles(files);
          }}
          onKeyDown={(e) => {
            // With a keyboard and pointer, Enter sends and Shift+Enter breaks the line. On touch
            // screens Return breaks the line, as in iMessage, and only the button sends.
            // Safari ends IME composition before this Enter, reporting it only as key 229.
            const composing = e.nativeEvent.isComposing || e.keyCode === 229;
            if (e.key !== "Enter" || e.shiftKey || composing) return;
            if (matchMedia("(pointer: coarse)").matches) return;
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }}
        />
        <Button
          type="submit"
          size="icon"
          className="flex-none"
          aria-label="Send message"
          disabled={sending || !ready(draft)}
        >
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}
