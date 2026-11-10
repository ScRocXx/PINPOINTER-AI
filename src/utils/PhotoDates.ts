/**
 * PhotoDates: the date maths behind the Photos tab, kept pure so it can be
 * tested without a phone.
 *
 * - `filterWindow()` turns a chip (Today, Yesterday, Last 7 days) into a
 *   time window. "Last 7 days" is today plus the six days before it; it used
 *   to show every photo older than yesterday, however old.
 * - `sectionFor()` / `groupIntoSections()` split a newest-first list into
 *   the headings the grid shows: Today, Yesterday, one per day for the rest
 *   of the week, then one per month.
 *
 * Days follow the phone's own clock and time zone, so a photo taken at
 * 23:50 belongs to that day, and a daylight-saving change never shifts it.
 */

export type DateFilter = 'all' | 'today' | 'yesterday' | 'lastWeek';

/** Days covered by "Last 7 days", today included. */
export const LAST_WEEK_DAYS = 7;

/** A time window in ms: `from` inclusive, `to` exclusive. null = open. */
export interface TimeWindow {
  from: number | null;
  to: number | null;
}

/** Midnight at the start of the day `ts` falls in (local time). */
export const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Midnight `days` days after (or before, if negative) the day of `ts`. */
export const addDays = (ts: number, days: number): number => {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() + days);
  return d.getTime();
};

/** The window a date chip covers, relative to `now`. */
export const filterWindow = (filter: DateFilter, now: number = Date.now()): TimeWindow => {
  const today = startOfDay(now);
  switch (filter) {
    case 'today':
      return { from: today, to: null };
    case 'yesterday':
      return { from: addDays(today, -1), to: today };
    case 'lastWeek':
      return { from: addDays(today, -(LAST_WEEK_DAYS - 1)), to: null };
    default:
      return { from: null, to: null };
  }
};

/** True when `ts` is inside `window`. */
export const inWindow = (ts: number, window: TimeWindow): boolean =>
  (window.from === null || ts >= window.from) && (window.to === null || ts < window.to);

/**
 * The same window in CameraRoll's terms: its `fromTime` is exclusive and
 * its `toTime` inclusive, so both move back by 1 ms.
 */
export const cameraRollTimes = (window: TimeWindow): { fromTime?: number; toTime?: number } => ({
  ...(window.from !== null ? { fromTime: window.from - 1 } : {}),
  ...(window.to !== null ? { toTime: window.to - 1 } : {}),
});

export type SectionKind = 'today' | 'yesterday' | 'day' | 'month';

/** Which heading a photo goes under. `date` is the day or month it starts. */
export interface DateSection {
  key: string;
  kind: SectionKind;
  /** Start of the day (today, yesterday, day) or of the month (month). */
  date: number;
}

/** The heading for a photo taken at `ts`, seen from `now`. */
export const sectionFor = (ts: number, now: number = Date.now()): DateSection => {
  const today = startOfDay(now);
  const day = startOfDay(ts);
  if (day >= today) {
    return { key: 'today', kind: 'today', date: today };
  }
  const yesterday = addDays(today, -1);
  if (day >= yesterday) {
    return { key: 'yesterday', kind: 'yesterday', date: yesterday };
  }
  if (day >= addDays(today, -(LAST_WEEK_DAYS - 1))) {
    return { key: `day-${day}`, kind: 'day', date: day };
  }
  const d = new Date(ts);
  const month = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return { key: `month-${d.getFullYear()}-${d.getMonth() + 1}`, kind: 'month', date: month };
};

export interface Grouped<T> extends DateSection {
  items: T[];
}

/**
 * Splits a newest-first list into date headings, keeping the order. Photos
 * whose dates arrive out of order still land under the right heading.
 */
export const groupIntoSections = <T>(
  items: ReadonlyArray<T>,
  timeOf: (item: T) => number,
  now: number = Date.now(),
): Grouped<T>[] => {
  const byKey = new Map<string, Grouped<T>>();
  const order: Grouped<T>[] = [];
  for (const item of items) {
    const section = sectionFor(timeOf(item), now);
    let group = byKey.get(section.key);
    if (!group) {
      group = { ...section, items: [] };
      byKey.set(section.key, group);
      order.push(group);
    }
    group.items.push(item);
  }
  return order;
};

/** Splits `items` into rows of `size` (the grid's columns). */
export const chunk = <T>(items: ReadonlyArray<T>, size: number): T[][] => {
  const rows: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += step) {
    rows.push(items.slice(i, i + step));
  }
  return rows;
};
