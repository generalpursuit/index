type State = { pending: Record<string, number>; failures: number; revision: number };
interface Transaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
export interface ScheduleStorage {
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
}
const empty = (): State => ({ pending: {}, failures: 0, revision: 0 });
async function earlier(tx: Transaction, at: number) {
  const current = await tx.getAlarm();
  if (current === null || current > at) await tx.setAlarm(at);
}

/** Durable wakeups, not a second queue. Postgres owns work and retry timestamps. */
export class OutboxSchedule {
  constructor(
    private storage: ScheduleStorage,
    private now = Date.now,
  ) {}
  async begin(id: string) {
    await this.storage.transaction(async (tx) => {
      const state = (await tx.get<State>("schedule")) ?? empty();
      state.pending[id] = this.now() + 120_000;
      await tx.put("schedule", state);
      await earlier(tx, state.pending[id]!);
    });
  }
  async finish(id?: string) {
    await this.storage.transaction(async (tx) => {
      const state = (await tx.get<State>("schedule")) ?? empty();
      if (id) delete state.pending[id];
      state.revision++;
      await tx.put("schedule", state);
      await earlier(tx, this.now());
    });
  }
  async run(drain: () => Promise<number | undefined>) {
    // Persist recovery before external I/O. A killed handler must not strand leased jobs.
    const { fallback, revision } = await this.storage.transaction(async (tx) => {
      const state = (await tx.get<State>("schedule")) ?? empty();
      for (const [id, deadline] of Object.entries(state.pending)) {
        if (deadline <= this.now()) delete state.pending[id];
      }
      const at = this.now() + Math.min(900_000, 30_000 * 2 ** Math.min(state.failures, 5));
      state.failures++;
      await tx.put("schedule", state);
      await earlier(tx, at);
      return { fallback: at, revision: state.revision };
    });
    const next = await drain();
    await this.storage.transaction(async (tx) => {
      const state = (await tx.get<State>("schedule")) ?? empty();
      state.failures = 0;
      const current = await tx.getAlarm();
      const candidates = [...Object.values(state.pending), ...(next === undefined ? [] : [next])];
      if (state.revision !== revision) candidates.push(this.now());
      // A request may have armed an earlier alarm while drain awaited the database/provider.
      if (current !== null && current !== fallback) candidates.push(current);
      await tx.put("schedule", state);
      if (candidates.length) await tx.setAlarm(Math.max(this.now(), Math.min(...candidates)));
      else await tx.deleteAlarm();
    });
  }
}
