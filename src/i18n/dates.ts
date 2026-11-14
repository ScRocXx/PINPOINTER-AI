import { StringKey, StringParams } from './strings';
import { startOfDay } from '../utils/PhotoDates';
import type { DateMeaning } from '../utils/DateQuery';

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

/** Whole calendar days from the day of `ts` to the day of `now` (phone's time zone). */
const daysAgo = (ts: number, now: number): number =>
  Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);

/**
 * When something happened, in the words people use: "just now" or
 * "3 hours ago" for today, "yesterday", "2 days ago" for the rest of the
 * week, then the date.
 *
 * Days are calendar days, the same ones the Photos headings use. Counting
 * 24-hour blocks instead called a photo from yesterday noon "22 hours ago"
 * all morning, under a heading that said Yesterday.
 */
export const formatWhen = (
  t: T,
  ago: (ts: number) => string,
  ts: number,
  now: number = Date.now(),
): string => {
  const days = daysAgo(ts, now);
  if (days <= 0) return ago(ts);
  if (days === 1) return t('time.yesterday');
  if (days < 7) return t('time.daysAgo', { n: days });
  return formatDay(t, ts, now);
};

/** What a search's date words meant: "Diwali, every year", "Last month", "March 2024". */
export const formatDateMeaning = (t: T, meaning: DateMeaning): string => {
  switch (meaning.kind) {
    case 'festival': {
      const name = t(`festival.${meaning.festival}` as StringKey);
      if (meaning.year !== undefined) return t('when.withYear', { name, year: String(meaning.year) });
      return t(meaning.latest ? 'when.latest' : 'when.everyYear', { name });
    }
    case 'relative':
      return t(`when.${meaning.relative}` as StringKey);
    case 'month':
      return formatMonth(t, new Date(meaning.year, meaning.month - 1, 1).getTime());
    case 'year':
      return String(meaning.year);
  }
};
