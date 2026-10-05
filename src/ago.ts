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
 * The time, re-read every 30s, so a row's `ago` is never more than 30s behind: well
 * inside criterion 12's 60s. A poll re-renders the rows with a fresh time too.
 */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [every]);
  return now;
}
