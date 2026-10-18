import { maxFilesPerMessage } from "@index/api/features/messages/files";
import type { MessageFile, MessageReply, SavedLink } from "@/lib/types";

export type MessageAttempt = Readonly<{
  conversationId: string;
  clientId: string;
  body: string;
  linkId?: string;
  replyToMessageId?: string;
  /** Uploaded files in their sent order; the request names them by ID. */
  files: readonly MessageFile[];
}>;
/** A file added to the draft, uploading until it has either uploaded or failed. */
export type DraftFile = Readonly<{
  localId: string;
  file: File;
  uploaded?: MessageFile;
  failed?: boolean;
}>;
type Draft = Readonly<{
  body: string;
  attachment?: SavedLink;
  queuedAttachment?: SavedLink;
  files: readonly DraftFile[];
  replyTo?: MessageReply;
  status: "editing" | "sending" | "uncertain" | "rejected";
}>;

/** Whether a draft can be sent: it carries something, and every file has uploaded. */
export function ready(draft: Draft) {
  return (
    (!!draft.body.trim() || !!draft.attachment || draft.files.length > 0) &&
    draft.files.every((file) => file.uploaded)
  );
}

/** A send owns its payload until its outcome is known, including across route changes. */
export class MessageDraft {
  private value: Draft = { body: "", files: [], status: "editing" };
  private attempt?: MessageAttempt;
  private active = true;
  private listeners = new Set<() => void>();

  constructor(readonly conversationId: string) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private change(value: Draft) {
    if (!this.active) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }
  editBody(body: string) {
    if (!this.attempt) this.change({ ...this.value, body, status: "editing" });
  }
  removeAttachment() {
    if (!this.attempt) this.change({ ...this.value, attachment: undefined, status: "editing" });
  }
  attach(attachment: SavedLink) {
    this.change(
      this.attempt
        ? { ...this.value, queuedAttachment: attachment }
        : { ...this.value, attachment, status: "editing" },
    );
  }
  removeQueuedAttachment() {
    this.change({ ...this.value, queuedAttachment: undefined });
  }
  reply(replyTo: MessageReply) {
    if (!this.attempt) this.change({ ...this.value, replyTo, status: "editing" });
  }
  removeReply() {
    if (!this.attempt) this.change({ ...this.value, replyTo: undefined, status: "editing" });
  }
  /** Adds files up to the per-message limit and returns those added, for uploading. */
  addFiles(files: File[]): DraftFile[] {
    if (this.attempt || !this.active) return [];
    const added = files
      .slice(0, Math.max(0, maxFilesPerMessage - this.value.files.length))
      .map((file) => ({ localId: crypto.randomUUID(), file }));
    if (added.length)
      this.change({ ...this.value, files: [...this.value.files, ...added], status: "editing" });
    return added;
  }
  fileUploaded(localId: string, uploaded: MessageFile) {
    this.updateFile(localId, { uploaded });
  }
  fileFailed(localId: string) {
    this.updateFile(localId, { failed: true });
  }
  removeFile(localId: string) {
    if (!this.attempt)
      this.change({
        ...this.value,
        files: this.value.files.filter((file) => file.localId !== localId),
        status: "editing",
      });
  }
  // An upload may finish after its file was removed; it then changes nothing.
  private updateFile(localId: string, change: Partial<DraftFile>) {
    if (!this.value.files.some((file) => file.localId === localId)) return;
    this.change({
      ...this.value,
      files: this.value.files.map((file) =>
        file.localId === localId ? { ...file, ...change } : file,
      ),
    });
  }
  prepare(): MessageAttempt | undefined {
    // An existing attempt is retried as it was frozen; only a new one needs a ready draft.
    if (!this.active || this.value.status === "sending" || (!this.attempt && !ready(this.value)))
      return;
    this.attempt ??= Object.freeze({
      conversationId: this.conversationId,
      clientId: crypto.randomUUID(),
      body: this.value.body,
      linkId: this.value.attachment?.id,
      replyToMessageId: this.value.replyTo?.id,
      files: Object.freeze(this.value.files.map((file) => file.uploaded!)),
    });
    this.change({ ...this.value, status: "sending" });
    return this.attempt;
  }
  complete(attempt: MessageAttempt) {
    if (attempt !== this.attempt) return;
    this.attempt = undefined;
    this.change({
      body: "",
      files: [],
      attachment: this.value.queuedAttachment,
      status: "editing",
    });
  }
  fail(attempt: MessageAttempt, error: unknown) {
    if (attempt !== this.attempt) return;
    // Validation rejects before writing. Transport/5xx/permission errors can follow an
    // accepted write, so keep the exact request for retry rather than risk a duplicate.
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : undefined;
    if (status === 400 || status === 413 || status === 422) {
      this.attempt = undefined;
      this.change({ ...this.value, status: "rejected" });
    } else this.change({ ...this.value, status: "uncertain" });
  }
  /** Explicitly confirmed by the person: this does not retract a possibly delivered message. */
  abandonUnconfirmed() {
    if (this.value.status !== "uncertain") return;
    this.attempt = undefined;
    this.change({
      body: "",
      files: [],
      attachment: this.value.queuedAttachment,
      status: "editing",
    });
  }
  discard() {
    this.attempt = undefined;
    this.change({ body: "", files: [], status: "editing" });
    this.active = false;
  }
}
