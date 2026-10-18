import { useState } from "react";
import { CircleAlert, FileText, LoaderCircle, X } from "lucide-react";
import { inlineImageTypes } from "@index/api/features/messages/files";
import { IconButton } from "@index/ui/components/icon-button";
import { useObjectURL } from "@/hooks/use-object-url";
import { fileDetails } from "./conversation-presentation";
import type { DraftFile } from "./draft";

/** The draft's files as tiles inside the composer field, scrolling sideways when many. */
export function ComposerFiles({
  files,
  locked,
  onRemove,
}: {
  files: readonly DraftFile[];
  locked: boolean;
  onRemove: (localId: string) => void;
}) {
  const announcement = useSettledAnnouncement(files);
  return (
    <>
      {/* Always mounted, so screen readers hear the first result too. Each announcement
          replaces the region's content, so the same words twice are still spoken. */}
      <p className="sr-only" role="status">
        <span key={announcement.count}>{announcement.text}</span>
      </p>
      {files.length > 0 && (
        // Without list styles Safari drops the list's role, so it is given back.
        <ul
          role="list"
          className="flex gap-2 overflow-x-auto p-0.5 [scrollbar-width:none]"
          aria-label="Attachments"
        >
          {files.map((item) => (
            <FileTile
              key={item.localId}
              item={item}
              locked={locked}
              onRemove={() => onRemove(item.localId)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** "Uploaded x" or "Couldn’t upload x" for the files that settled in the latest change. */
function useSettledAnnouncement(files: readonly DraftFile[]) {
  const [previous, setPrevious] = useState(files);
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  if (files !== previous) {
    setPrevious(files);
    const settled = (item: DraftFile) => !!item.uploaded || !!item.failed;
    const justSettled = files.filter(
      (item) =>
        settled(item) &&
        !previous.some((before) => before.localId === item.localId && settled(before)),
    );
    if (justSettled.length)
      setAnnouncement({
        text: justSettled
          .map((item) =>
            item.failed ? `Couldn’t upload ${item.file.name}` : `Uploaded ${item.file.name}`,
          )
          .join(". "),
        count: announcement.count + 1,
      });
  }
  return announcement;
}

// The marks and the remove button sit over photos, so they stay dark in either theme.
function FileTile({
  item,
  locked,
  onRemove,
}: {
  item: DraftFile;
  locked: boolean;
  onRemove: () => void;
}) {
  // Photos are the types the thread shows inline, so a draft looks as it will once sent. One
  // the browser can't decode shows as a file instead.
  const [undecodable, setUndecodable] = useState(false);
  const photo = inlineImageTypes.has(item.file.type) && !undecodable;
  const preview = useObjectURL(photo ? item.file : null);
  const state = item.failed ? "failed" : item.uploaded ? "uploaded" : "uploading";
  return (
    <li
      className="draft-file relative flex-none h-24 overflow-hidden rounded-[14px] border border-border bg-surface"
      data-state={state}
    >
      {photo ? (
        <img
          src={preview ?? undefined}
          alt={item.file.name}
          draggable={false}
          onError={() => setUndecodable(true)}
          className="h-full w-auto min-w-16 max-w-40 object-cover"
        />
      ) : (
        <div className="flex h-full w-34 flex-col justify-between p-[10px_12px]">
          <FileText className="size-4.5 text-subtle-foreground" aria-hidden="true" />
          <span className="min-w-0 pr-4">
            <strong className="block truncate text-[12.5px] font-medium">{item.file.name}</strong>
            <small className="text-[11px] text-subtle-foreground">
              {fileDetails(item.file.name, item.file.size)}
            </small>
          </span>
        </div>
      )}
      {state !== "uploaded" && (
        <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
          {state === "failed" ? (
            <CircleAlert
              className="size-6"
              role="img"
              aria-label={`Couldn’t upload ${item.file.name}`}
            />
          ) : (
            <LoaderCircle
              className="size-6 animate-spin"
              role="img"
              aria-label={`Uploading ${item.file.name}`}
            />
          )}
        </span>
      )}
      <IconButton
        label={"Remove " + item.file.name}
        disabled={locked}
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 size-5.5 rounded-full bg-black/60 text-white hover:bg-black/75 hover:text-white dark:hover:bg-black/75"
      >
        <X className="size-3" />
      </IconButton>
    </li>
  );
}
