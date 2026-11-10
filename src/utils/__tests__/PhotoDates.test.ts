import {
  addDays,
  cameraRollTimes,
  chunk,
  filterWindow,
  groupIntoSections,
  inWindow,
  sectionFor,
  startOfDay,
} from '../PhotoDates';

// Wednesday 11 Nov 2026, 10:30 local time. Local dates keep the tests right
// in any time zone the suite runs in.
const NOW = new Date(2026, 10, 11, 10, 30).getTime();
const at = (day: number, hour = 12, month = 10, year = 2026) => new Date(year, month, day, hour).getTime();

describe('startOfDay / addDays', () => {
  it('goes to local midnight', () => {
    expect(startOfDay(NOW)).toBe(new Date(2026, 10, 11).getTime());
  });

  it('moves by calendar days across a month end', () => {
    expect(addDays(at(1), -1)).toBe(new Date(2026, 9, 31).getTime());
    expect(addDays(at(30, 23), 1)).toBe(new Date(2026, 11, 1).getTime());
  });
});

describe('filterWindow', () => {
  it('Today starts at midnight and has no end', () => {
    expect(filterWindow('today', NOW)).toEqual({ from: startOfDay(NOW), to: null });
  });

  it('Yesterday is the whole day before today', () => {
    expect(filterWindow('yesterday', NOW)).toEqual({ from: new Date(2026, 10, 10).getTime(), to: startOfDay(NOW) });
  });

  it('Last 7 days is today and the six days before, not everything older', () => {
    const w = filterWindow('lastWeek', NOW);
    expect(w).toEqual({ from: new Date(2026, 10, 5).getTime(), to: null });
    expect(inWindow(at(11, 9), w)).toBe(true); // today
    expect(inWindow(at(10), w)).toBe(true); // yesterday
    expect(inWindow(at(5, 0), w)).toBe(true); // six days ago, just after midnight
    expect(inWindow(at(4, 23), w)).toBe(false); // seven days ago
    expect(inWindow(at(1, 12, 9), w)).toBe(false); // last month: the old bug showed these
  });

  it('All has no limits', () => {
    expect(filterWindow('all', NOW)).toEqual({ from: null, to: null });
  });
});

describe('inWindow', () => {
  it('includes the start and excludes the end', () => {
    const w = { from: 100, to: 200 };
    expect(inWindow(100, w)).toBe(true);
    expect(inWindow(199, w)).toBe(true);
    expect(inWindow(200, w)).toBe(false);
    expect(inWindow(99, w)).toBe(false);
  });
});

describe('cameraRollTimes', () => {
  it('turns [from, to) into CameraRoll’s exclusive fromTime and inclusive toTime', () => {
    expect(cameraRollTimes({ from: 1000, to: 5000 })).toEqual({ fromTime: 999, toTime: 4999 });
  });

  it('leaves out open ends', () => {
    expect(cameraRollTimes({ from: null, to: null })).toEqual({});
    expect(cameraRollTimes({ from: 1000, to: null })).toEqual({ fromTime: 999 });
  });
});

describe('sectionFor', () => {
  it('names today and yesterday', () => {
    expect(sectionFor(at(11, 0), NOW).kind).toBe('today');
    expect(sectionFor(at(10, 23), NOW).kind).toBe('yesterday');
  });

  it('gives each of the other days this week its own heading', () => {
    const s = sectionFor(at(6, 15), NOW);
    expect(s).toEqual({ key: `day-${new Date(2026, 10, 6).getTime()}`, kind: 'day', date: new Date(2026, 10, 6).getTime() });
  });

  it('groups older photos by month', () => {
    expect(sectionFor(at(4), NOW)).toEqual({ key: 'month-2026-11', kind: 'month', date: new Date(2026, 10, 1).getTime() });
    expect(sectionFor(at(20, 12, 9), NOW)).toMatchObject({ key: 'month-2026-10', kind: 'month' });
    expect(sectionFor(at(20, 12, 9, 2025), NOW)).toMatchObject({ key: 'month-2025-10' });
  });

  it('treats a photo dated in the future as today', () => {
    expect(sectionFor(at(12), NOW).kind).toBe('today');
  });
});

describe('groupIntoSections', () => {
  it('keeps the order and puts late arrivals under the right heading', () => {
    const photos = [at(11, 9), at(10), at(20, 12, 9), at(11, 8), at(3)];
    const groups = groupIntoSections(photos, p => p, NOW);
    expect(groups.map(g => g.key)).toEqual(['today', 'yesterday', 'month-2026-10', 'month-2026-11']);
    expect(groups[0].items).toEqual([at(11, 9), at(11, 8)]);
  });

  it('returns nothing for no photos', () => {
    expect(groupIntoSections([], (p: number) => p, NOW)).toEqual([]);
  });
});

describe('chunk', () => {
  it('splits into rows of the column count', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('never loops on a bad size', () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});
