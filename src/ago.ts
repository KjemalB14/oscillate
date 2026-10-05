import { useEffect, useState } from "react";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `at` was, as a row shows it: `now` under a minute (or in the future),
 * then `Nm`, `Nh` and `Nd`, each rounded down.
 */
export function ago(at: number, now: number): string {
  const d = now - at;
  if (d < MINUTE) return "now";
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  return `${Math.floor(d / DAY)}d`;
}

/**
 * The time at this render, with a re-render every 30s, so a row's `ago` is never more
 * than 30s behind: well inside criterion 12's 60s. A render for any other reason, such
 * as a poll, reads the clock afresh too.
 */
export function useNow(every = 30_000): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), every);
    return () => window.clearInterval(id);
  }, [every]);
  return Date.now();
}
