import type { RefObject } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@index/ui/components/dialog";
import { IconButton } from "@index/ui/components/icon-button";
import { useAPI } from "@/hooks/use-api";
import { useObjectURL } from "@/hooks/use-object-url";
import type { Message, MessageFile } from "@/lib/types";
import { fileDetails } from "./conversation-presentation";
import { messageFileOptions } from "./queries";
import { actionClassName, cardStyle } from "./shared-post";

export const isPhoto = (file: MessageFile) => file.type.startsWith("image/");
/** A photo's shape as its sender measured it, kept between 1:2 and 2:1. */
const shape = (file: MessageFile) =>
  file.width && file.height ? Math.min(2, Math.max(1 / 2, file.width / file.height)) : 4 / 3;

/**
 * A message's files above its text: photos as images, anything else as a card that saves it.
 * Its message is the tab stop; the message's menu opens and saves these from the keyboard.
 */
export function MessageFiles({
  message,
  onOpenPhoto,
}: {
  message: Message;
  onOpenPhoto: (file: MessageFile) => void;
}) {
  const photos = message.files.filter(isPhoto),
    others = message.files.filter((file) => !isPhoto(file));
  // Several photos share square cells, as on iOS.
  const several = photos.length > 1;
  return (
    <>
      {photos.length > 0 && (
        <div className={"grid gap-[3px] max-w-full " + (several ? "grid-cols-2 w-75" : "w-65")}>
          {photos.map((file) => (
            <Photo
              key={file.id}
              conversationId={message.conversationId}
              file={file}
              square={several}
              onOpen={() => onOpenPhoto(file)}
            />
          ))}
        </div>
      )}
      {others.map((file) => (
        <FileCard key={file.id} conversationId={message.conversationId} file={file} />
      ))}
    </>
  );
}

function Photo({
  conversationId,
  file,
  square,
  onOpen,
}: {
  conversationId: string;
  file: MessageFile;
  square: boolean;
  onOpen: () => void;
}) {
  const api = useAPI();
  const { data, isError } = useQuery(messageFileOptions(api, conversationId, file.id));
  const url = useObjectURL(data);
  return (
    <button
      type="button"
      tabIndex={-1}
      className={
        "message-photo message-surface relative block w-full overflow-hidden rounded-[14px] bg-surface cursor-zoom-in disabled:cursor-default " +
        (square ? "aspect-square" : "max-h-80") +
        (!url && !isError ? " animate-pulse" : "")
      }
      // The size the sender measured holds the thread still while the image loads.
      style={square ? undefined : { aspectRatio: shape(file) }}
      disabled={!url}
      onClick={onOpen}
    >
      {/* The viewer names the file; here the message reads as having a photo. */}
      {url && <img src={url} alt="Photo" className="size-full object-cover" />}
      {isError && (
        <span className="absolute inset-0 grid place-items-center text-[12px] text-subtle-foreground">
          Photo unavailable
        </span>
      )}
    </button>
  );
}

/**
 * A photo shown large, with a button that saves it. It sits outside its message's menu and swipe,
 * so a right click here gives the browser's own image menu. Closing returns focus to
 * `finalFocus`, the photo's message.
 */
export function PhotoViewer({
  conversationId,
  file,
  open,
  onOpenChange,
  onClosed,
  finalFocus,
}: {
  conversationId: string;
  file: MessageFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Once the viewer has finished closing. */
  onClosed: () => void;
  finalFocus: RefObject<HTMLElement | null>;
}) {
  const api = useAPI(),
    save = useSaveFile();
  // Usually already cached by the thread's photo.
  const { data, isError } = useQuery(messageFileOptions(api, conversationId, file.id));
  const url = useObjectURL(data);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(opened) => {
        if (!opened) onClosed();
      }}
    >
      {/* The primitive caps itself with `sm:max-w-sm`, so the large size overrides it too. Its
          close button and the save beside it sit over the photo, so they keep the dialog's
          surface to stay legible. */}
      <DialogContent
        finalFocus={finalFocus}
        className="w-max max-w-[min(92vw,1200px)] sm:max-w-[min(92vw,1200px)] p-2 [&_[data-slot=dialog-close]]:bg-popover [&_[data-slot=dialog-close]]:hover:bg-muted"
      >
        <DialogTitle className="sr-only">{file.name}</DialogTitle>
        {url ? (
          <img src={url} alt={file.name} className="max-h-[85vh] max-w-full object-contain" />
        ) : (
          <div
            className={
              "grid w-[min(80vw,480px)] max-h-[85vh] place-items-center bg-surface text-[13px] text-subtle-foreground " +
              (isError ? "" : "animate-pulse")
            }
            style={{ aspectRatio: shape(file) }}
          >
            {isError && "Photo unavailable"}
          </div>
        )}
        <IconButton
          label="Download"
          size="icon-sm"
          className="absolute top-2 right-10 bg-popover hover:bg-muted dark:hover:bg-muted"
          disabled={!url}
          onClick={() => void save(conversationId, file)}
        >
          <Download />
        </IconButton>
      </DialogContent>
    </Dialog>
  );
}

function FileCard({ conversationId, file }: { conversationId: string; file: MessageFile }) {
  const api = useAPI(),
    save = useSaveFile();
  // Also while saving from the message's menu, since both read the same query.
  const saving =
    useIsFetching({
      queryKey: messageFileOptions(api, conversationId, file.id).queryKey,
      exact: true,
    }) > 0;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-busy={saving || undefined}
      className={"message-file message-surface " + cardStyle + " " + actionClassName}
      onClick={() => void save(conversationId, file)}
    >
      <FileText />
      <span>
        <strong>{file.name}</strong>
        <small>{fileDetails(file.name, file.size)}</small>
      </span>
      {saving ? (
        <LoaderCircle className="ml-auto animate-spin" aria-label="Downloading" />
      ) : (
        <Download className="ml-auto" aria-label="Download" />
      )}
    </button>
  );
}

/**
 * The files being saved, by ID. Kept apart from their queries: a file the thread is still loading
 * is fetching without being saved, and saving it then waits for that load.
 */
const saving = new Set<string>();

/**
 * Saves a sent file as a download: to the browser's downloads, or to Downloads on desktop. A file
 * already being saved is not saved twice, and its bytes are not kept once saved.
 */
export function useSaveFile() {
  const api = useAPI(),
    cache = useQueryClient();
  return async (conversationId: string, file: MessageFile) => {
    if (saving.has(file.id)) return;
    saving.add(file.id);
    const options = { ...messageFileOptions(api, conversationId, file.id), gcTime: 0 };
    try {
      const blob = await cache.fetchQuery(options);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: file.name }).click();
      // The download reads the address after this click returns.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error(`Couldn’t download ${file.name}.`);
    } finally {
      saving.delete(file.id);
    }
  };
}
