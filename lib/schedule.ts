// How often the scheduler wakes up. A post time counts as "due" for exactly
// one tick: the one whose window [tick, tick + interval) contains it.
export const SCHEDULER_INTERVAL_MIN = 5;

const MINUTES_PER_DAY = 24 * 60;

function minutesOfDayInTz(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
}

function parseHHMM(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// True when `now`, read in the channel's timezone, falls within one
// scheduler interval after any of the channel's post times. Because the
// interval matches the cron tick spacing, each post time fires exactly once
// per day. Returns false for an unknown timezone rather than throwing, so one
// misconfigured channel can't break scheduling for the rest.
export function isPostTimeDue(
  postTimes: string[],
  timeZone: string,
  now: Date = new Date(),
): boolean {
  let current: number;
  try {
    current = minutesOfDayInTz(now, timeZone);
  } catch {
    return false;
  }

  return postTimes.some((time) => {
    const slot = parseHHMM(time);
    if (slot === null) return false;
    const elapsed = (current - slot + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return elapsed < SCHEDULER_INTERVAL_MIN;
  });
}
