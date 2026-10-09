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
export function weekLabel(value: string) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + 3);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return "Week " + Math.ceil(((date.getTime() - start.getTime()) / 86400000 + 1) / 7);
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
