export function monday(value = new Date()) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function shiftWeek(value: string, direction: number) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + direction * 7);
  return date.toISOString().slice(0, 10);
}
/** A week's Thursday, which decides its number and year. */
function thursday(value: string) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + 3);
  return date;
}
export function weekNumber(value: string) {
  const date = thursday(value);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - start.getTime()) / 86400000 + 1) / 7);
}
export function weekLabel(value: string) {
  return "Week " + weekNumber(value);
}
/**
 * For a newest-first list of weeks, the year where a new one starts: on the first listed week
 * after weeks of an earlier year, null elsewhere.
 */
export function yearMarks(weeks: readonly string[]) {
  const years = weeks.map((week) => thursday(week).getUTCFullYear());
  return years.map((year, index) => {
    const older = years[index + 1];
    return older !== undefined && older !== year ? String(year) : null;
  });
}
/** "5 – 11 Oct", with the year when the week falls outside the current one. */
export function weekRange(value: string) {
  const start = new Date(value + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const year = new Date().getUTCFullYear();
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: start.getUTCFullYear() === year && end.getUTCFullYear() === year ? undefined : "numeric",
    timeZone: "UTC",
  }).formatRange(start, end);
}
/** "12 Oct" for a date, with the year when it falls outside the current one. */
export function dayLabel(value: string) {
  const date = new Date(value + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}
export function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  return minutes < 1
    ? "Now"
    : minutes < 60
      ? minutes + "m"
      : minutes < 1440
        ? Math.floor(minutes / 60) + "h"
        : Math.floor(minutes / 1440) + "d";
}
