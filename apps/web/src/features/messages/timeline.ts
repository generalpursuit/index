import type { Message } from "@/lib/types";

/** Consecutive messages from one sender, shown as one block. */
export type MessageRun = { senderId: string; messages: Message[] };
/** Runs after a date stamp; a new section starts after a long pause. */
export type TimelineSection = { at: string; runs: MessageRun[] };

const pause = 60 * 60 * 1000;

/** Groups oldest-first messages into stamped sections of sender runs, as iMessage does. */
export function messageTimeline(messages: readonly Message[]) {
  const sections: TimelineSection[] = [];
  let previous: Message | undefined;
  for (const message of messages) {
    const section = sections.at(-1),
      run = section?.runs.at(-1);
    if (
      !section ||
      !run ||
      !previous ||
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) >= pause
    )
      sections.push({
        at: message.createdAt,
        runs: [{ senderId: message.senderId, messages: [message] }],
      });
    else if (run.senderId === message.senderId) run.messages.push(message);
    else section.runs.push({ senderId: message.senderId, messages: [message] });
    previous = message;
  }
  return sections;
}

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }),
  weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" }),
  thisYear = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }),
  otherYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }),
  exact = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short" });

/**
 * A section stamp in the viewer's time zone, split so the day can be emphasised:
 * "Today 11:15", "Yesterday 09:02", "Monday 14:20", "Sun 4 Oct at 02:19".
 */
export function stampLabel(value: string, now = new Date()) {
  const at = new Date(value),
    day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Rounding absorbs daylight-saving days that are an hour shorter or longer.
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return { day: "Today", time: time.format(at) };
  if (days === 1) return { day: "Yesterday", time: time.format(at) };
  if (days < 7) return { day: weekday.format(at), time: time.format(at) };
  return {
    day: (at.getFullYear() === now.getFullYear() ? thisYear : otherYear).format(at),
    time: "at " + time.format(at),
  };
}

/** The full date and time, offered on hover. */
export function exactTime(value: string) {
  return exact.format(new Date(value));
}
