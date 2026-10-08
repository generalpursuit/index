import { z } from "zod";
// Calendar dates use ISO Monday weeks, independent of server/client timezone.
export const weekStartSchema = z.iso
  .date()
  .refine((value) => !value.startsWith("0000-"), "Use a supported year.")
  .refine(
    (value) => new Date(value + "T00:00:00Z").getUTCDay() === 1,
    "Use the Monday date of the week.",
  );
export function shiftWeek(start: string, direction: number) {
  const date = new Date(start + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + direction * 7);
  return date.toISOString().slice(0, 10);
}
export function currentWeekStart() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
