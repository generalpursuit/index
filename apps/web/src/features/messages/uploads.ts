import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  inlineImageTypes,
  maxFileBytes,
  maxFilesPerMessage,
} from "@index/api/features/messages/files";
import type { useAPI } from "@/hooks/use-api";
import { onAccountClear } from "@/lib/account-boundary";
import type { MessageFile } from "@/lib/types";
import type { MessageDraft } from "./draft";
import { messageFileOptions } from "./queries";
import { createUploadQueue } from "./upload-queue";

// Two uploads at a time, so neither the device nor the server holds many large files at once.
const queue = createUploadQueue(2);
/** Uploads not yet settled, by their draft file, so removing a file can stop its upload. */
const uploads = new Map<string, AbortController>();
onAccountClear(() => {
  queue.clear();
  uploads.clear();
});

/**
 * Adds files to a draft and uploads each at once. Like the draft, uploads continue when the
 * page changes; a failed upload stays in the draft, marked, until removed.
 */
export function addDraftFiles(
  owner: MessageDraft,
  files: File[],
  api: ReturnType<typeof useAPI>,
  cache: QueryClient,
) {
  const { status } = owner.getSnapshot();
  if (status === "sending" || status === "uncertain")
    return void toast.error("Send or discard this message before adding files.");
  const fitting = files.filter((file) => file.size <= maxFileBytes);
  if (fitting.length < files.length)
    toast.error(`Files can be at most ${maxFileBytes / 1_000_000} MB.`);
  const added = owner.addFiles(fitting);
  if (added.length < fitting.length)
    toast.error(`A message can carry up to ${maxFilesPerMessage} files.`);
  for (const { localId, file } of added)
    uploads.set(
      localId,
      queue.enqueue((signal) =>
        upload(owner, localId, file, api, cache, signal).finally(() => uploads.delete(localId)),
      ),
    );
}

/** Removes a file from its draft, stopping its upload if it is still running or waiting. */
export function removeDraftFile(owner: MessageDraft, localId: string) {
  uploads.get(localId)?.abort();
  // A waiting upload never runs once aborted, so it can't remove its own entry.
  uploads.delete(localId);
  owner.removeFile(localId);
}

async function upload(
  owner: MessageDraft,
  localId: string,
  file: File,
  api: ReturnType<typeof useAPI>,
  cache: QueryClient,
  signal: AbortSignal,
) {
  // Also false once the draft is discarded, which empties its files.
  const inDraft = () => owner.getSnapshot().files.some((added) => added.localId === localId);
  if (!inDraft()) return;
  const { conversationId } = owner;
  const size = await imageSize(file);
  let uploaded: MessageFile;
  try {
    uploaded = await api.messages.upload.call({ conversationId, file, ...size }, { signal });
  } catch {
    return owner.fileFailed(localId);
  }
  // The sender already has a photo's bytes, so the thread shows it without downloading. Other
  // files aren't seeded: they download only when opened. Seeding through the query's own
  // options keeps its shorter memory lifetime.
  if (uploaded.type.startsWith("image/") && inDraft())
    void cache.prefetchQuery({
      ...messageFileOptions(api, conversationId, uploaded.id),
      queryFn: () => file,
    });
  owner.fileUploaded(localId, uploaded);
}

/** A photo's pixel size, so the thread can reserve its space; nothing for other files. */
async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!inlineImageTypes.has(file.type)) return {};
  try {
    // As displayed: a rotated phone photo would otherwise report its sides swapped.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}
