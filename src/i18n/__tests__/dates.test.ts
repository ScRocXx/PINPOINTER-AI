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
});
