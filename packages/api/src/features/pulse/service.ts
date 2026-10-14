import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { activityPulse, messagesPulse } from "./repository";

export function getPulse(db: QueryDatabase, actorId: string) {
  return ResultAsync.combine([messagesPulse(db, actorId), activityPulse(db, actorId)]).map(
    ([messages, activity]) => ({ messages, activity }),
  );
}
