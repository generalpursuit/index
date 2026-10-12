export type LinkDraft = { url: string; title: string; description: string; groupId: string | null };

/** Only unsaved edits are retained. A late save cannot discard more recent edits. */
export class LinkDrafts {
  private drafts = new Map<string, LinkDraft>();
  read(id: string, saved: LinkDraft) {
    return this.drafts.get(id) ?? saved;
  }
  edit(id: string, value: LinkDraft) {
    this.drafts.set(id, value);
  }
  complete(id: string, submitted: LinkDraft) {
    if (this.drafts.get(id) === submitted) this.drafts.delete(id);
  }
  clear() {
    this.drafts.clear();
  }
}
