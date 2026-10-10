/** Retry identity is in memory, scoped to the account generation AND immutable payload. */
export class ShareAttempt {
  private attempt?: { key: string; id: string };
  request(url: string, groupId: string | null, generation: number, saveAgain = false) {
    const key = JSON.stringify([generation, url, groupId, saveAgain]);
    if (this.attempt?.key !== key) this.attempt = { key, id: crypto.randomUUID() };
    return { url, groupId, requestId: this.attempt.id, saveAgain };
  }
  complete() {
    this.attempt = undefined;
  }
}
