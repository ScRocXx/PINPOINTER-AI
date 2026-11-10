import { StringKey, StringParams } from './strings';

type T = (key: StringKey, params?: StringParams) => string;

const monthName = (t: T, date: Date): string => t(`month.${date.getMonth() + 1}` as StringKey);

/*
 * Numbers go in as strings: t() groups numbers the Indian way, which would
 * turn the year 2026 into "2,026".
 */

/** "3 November" (and "3 November 2025" when it isn't this year). */
export const formatDay = (t: T, ts: number, now: number = Date.now()): string => {
  const d = new Date(ts);
  const day = String(d.getDate());
  const month = monthName(t, d);
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return t('gallery.dayMonth', { day, month });
  }
  return t('gallery.dayMonthYear', { day, month, year: String(d.getFullYear()) });
};

/** "November 2026". */
export const formatMonth = (t: T, ts: number): string => {
  const d = new Date(ts);
  return t('gallery.monthYear', { month: monthName(t, d), year: String(d.getFullYear()) });
};

/**
 * When something happened, in the words people use: "just now",
 * "2 days ago" for the last week, then the date.
 */
export const formatWhen = (
  t: T,
  ago: (ts: number) => string,
  ts: number,
  now: number = Date.now(),
): string => (now - ts < 7 * 86_400_000 ? ago(ts) : formatDay(t, ts, now));
