import { format } from "date-fns";

export const NIGHTLY_HOUR = 23;
export const DISCOVERY_HOUR = 9;

export interface Run {
  job: "nightly" | "discover";
  /** The same all day, so a run that failed can be tried again that day. */
  key: string;
}

/**
 * The runs due by `now`, in the process's time zone (`TZ`): every night from
 * 23:00, and on the first Monday of each month from 9:00 when there's an area
 * to look in.
 */
export function dueRuns(now: Date, discovery: boolean): Run[] {
  const today = format(now, "yyyy-MM-dd");
  const runs: Run[] = [];
  if (now.getHours() >= NIGHTLY_HOUR) {
    runs.push({ job: "nightly", key: `nightly ${today}` });
  }
  const firstMonday = now.getDay() === 1 && now.getDate() <= 7;
  if (discovery && firstMonday && now.getHours() >= DISCOVERY_HOUR) {
    runs.push({ job: "discover", key: `discover ${today}` });
  }
  return runs;
}
