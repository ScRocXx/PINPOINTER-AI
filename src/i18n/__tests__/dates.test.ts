import { formatDay, formatMonth, formatWhen } from '../dates';
import { relativeTime, translate, StringKey, StringParams } from '../strings';

const tEn = (key: StringKey, params?: StringParams) => translate('en', key, params);
const tHi = (key: StringKey, params?: StringParams) => translate('hi', key, params);

const NOW = new Date(2026, 10, 11, 10, 30).getTime();

describe('date words', () => {
  it('writes a day this year without the year', () => {
    expect(formatDay(tEn, new Date(2026, 10, 3).getTime(), NOW)).toBe('3 November');
    expect(formatDay(tHi, new Date(2026, 10, 3).getTime(), NOW)).toBe('3 नवंबर');
  });

  it('adds the year for other years, without Indian digit grouping', () => {
    expect(formatDay(tEn, new Date(2025, 0, 26).getTime(), NOW)).toBe('26 January 2025');
  });

  it('writes a month heading', () => {
    expect(formatMonth(tEn, new Date(2026, 9, 1).getTime())).toBe('October 2026');
    expect(formatMonth(tHi, new Date(2026, 9, 1).getTime())).toBe('अक्टूबर 2026');
  });

  it('says how long ago for the last week, then the date', () => {
    const ago = (ts: number) => relativeTime('en', ts, NOW);
    expect(formatWhen(tEn, ago, NOW - 2 * 86_400_000, NOW)).toBe('2 days ago');
    expect(formatWhen(tEn, ago, new Date(2026, 9, 2).getTime(), NOW)).toBe('2 October');
  });

  describe('formatWhen counts calendar days, like the Photos headings', () => {
    const at = (day: number, hour: number, min = 0) => new Date(2026, 10, day, hour, min).getTime();
    const when = (ts: number, now: number, t = tEn, lang: 'en' | 'hi' = 'en') =>
      formatWhen(t, (x: number) => relativeTime(lang, x, now), ts, now);

    it('calls yesterday "yesterday" at any hour of today', () => {
      // 10:30 today, photo from noon yesterday: under 24 hours ago.
      expect(when(at(10, 12), NOW)).toBe('yesterday');
      expect(when(at(10, 0, 1), at(11, 23, 59))).toBe('yesterday');
      // Ten minutes ago, but it was yesterday.
      expect(when(at(10, 23, 55), at(11, 0, 5))).toBe('yesterday');
      expect(when(at(10, 12), NOW, tHi, 'hi')).toBe('कल');
    });

    it('keeps minutes and hours for today', () => {
      expect(when(at(11, 10, 25), NOW)).toBe('5 min ago');
      expect(when(at(11, 1), at(11, 23))).toBe('22 hours ago');
      // A clock that jumped back must not turn into a date.
      expect(when(NOW + 60_000, NOW)).toBe('just now');
    });

    it('counts the days before yesterday by the calendar, up to a week', () => {
      // 47 hours ago is two days back on the calendar, not "yesterday".
      expect(when(at(9, 23), at(11, 22))).toBe('2 days ago');
      expect(when(at(5, 23), NOW)).toBe('6 days ago');
      expect(when(at(4, 23), NOW)).toBe('4 November');
    });
  });
});
