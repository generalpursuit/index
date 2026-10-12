import type { SavedLink } from "@/lib/types";

export type MessageAttempt = Readonly<{
  conversationId: string;
  clientId: string;
  body: string;
  linkId?: string;
}>;
type Draft = Readonly<{
  body: string;
  attachment?: SavedLink;
  queuedAttachment?: SavedLink;
  status: "editing" | "sending" | "uncertain" | "rejected";
}>;

/** A send owns its payload until its outcome is known, including across route changes. */
export class MessageDraft {
  private value: Draft = { body: "", status: "editing" };
  private attempt?: MessageAttempt;
  private active = true;
  private listeners = new Set<() => void>();

  constructor(private conversationId: string) {}
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
  prepare(): MessageAttempt | undefined {
    if (
      !this.active ||
      this.value.status === "sending" ||
      (!this.value.body.trim() && !this.value.attachment)
    )
      return;
    this.attempt ??= Object.freeze({
      conversationId: this.conversationId,
      clientId: crypto.randomUUID(),
      body: this.value.body,
      linkId: this.value.attachment?.id,
    });
    this.change({ ...this.value, status: "sending" });
    return this.attempt;
  }
  complete(attempt: MessageAttempt) {
    if (attempt !== this.attempt) return;
    this.attempt = undefined;
    this.change({ body: "", attachment: this.value.queuedAttachment, status: "editing" });
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
    this.change({ body: "", attachment: this.value.queuedAttachment, status: "editing" });
  }
  discard() {
    this.attempt = undefined;
    this.change({ body: "", status: "editing" });
    this.active = false;
  }
}
