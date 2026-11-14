import { festivalDays, FestivalId, hijriToGregorian, moonPhaseJde, parseDateQuery, sunSign } from '../DateQuery';

/** Festival days as celebrated in India, 2016–2025. */
const KNOWN: Record<FestivalId, string[]> = {
    diwali: ['2016-10-30', '2017-10-19', '2018-11-07', '2019-10-27', '2020-11-14', '2021-11-04', '2022-10-24', '2023-11-12', '2024-10-31', '2025-10-20'],
    holi: ['2016-03-24', '2017-03-13', '2018-03-02', '2019-03-21', '2020-03-10', '2021-03-29', '2022-03-18', '2023-03-08', '2024-03-25', '2025-03-14'],
    rakhi: ['2016-08-18', '2017-08-07', '2018-08-26', '2019-08-15', '2020-08-03', '2021-08-22', '2022-08-11', '2023-08-30', '2024-08-19', '2025-08-09'],
    ganesh: ['2016-09-05', '2017-08-25', '2018-09-13', '2019-09-02', '2020-08-22', '2021-09-10', '2022-08-31', '2023-09-19', '2024-09-07', '2025-08-27'],
    dussehra: ['2016-10-11', '2017-09-30', '2018-10-19', '2019-10-08', '2020-10-25', '2021-10-15', '2022-10-05', '2023-10-24', '2024-10-12', '2025-10-02'],
    navratri: ['2020-10-17', '2021-10-07', '2022-09-26', '2023-10-15', '2024-10-03', '2025-09-22'],
    karva: ['2021-10-24', '2022-10-13', '2023-11-01', '2024-10-20', '2025-10-10'],
    chhath: ['2021-11-10', '2022-10-30', '2023-11-19', '2024-11-07', '2025-10-27'],
    eid: ['2019-06-05', '2020-05-25', '2021-05-14', '2022-05-03', '2023-04-22', '2024-04-11', '2025-03-31'],
    bakrid: ['2019-08-12', '2020-08-01', '2021-07-21', '2022-07-10', '2023-06-29', '2024-06-17', '2025-06-07'],
    christmas: ['2023-12-25'],
    newyear: ['2024-01-01'],
    sankranti: ['2024-01-15'],
    republic: ['2024-01-26'],
    independence: ['2024-08-15'],
};

const utcDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe('festivalDays', () => {
    for (const [id, dates] of Object.entries(KNOWN) as Array<[FestivalId, string[]]>) {
        it(`${id}: the computed days hold the real day every year`, () => {
            for (const ds of dates) {
                const [y, m, d] = ds.split('-').map(Number);
                const f = festivalDays(id, y);
                expect(f).not.toBeNull();
                const n = utcDay(y, m, d);
                const from = utcDay(f!.start.y, f!.start.m, f!.start.d);
                const to = utcDay(f!.end.y, f!.end.m, f!.end.d);
                expect({ ds, inside: n >= from && n <= to }).toEqual({ ds, inside: true });
                // Windows stay short: a festival, not a season.
                expect((to - from) / 86400000).toBeLessThanOrEqual(11);
            }
        });
    }
});

describe('astronomy helpers', () => {
    it('finds the January 2000 new moon (Meeus example epoch)', () => {
        const ms = (moonPhaseJde(0) - 2440587.5) * 86400000;
        expect(new Date(ms).toISOString().slice(0, 10)).toBe('2000-01-06');
    });

    it('puts the sun in Tula in late October and Kumbha in late February', () => {
        expect(sunSign(2460246.5)).toBe(6); // 2023-10-29
        expect(sunSign(2460365.5)).toBe(10); // 2024-02-25
    });

    it('converts Islamic dates', () => {
        expect(hijriToGregorian(1445, 10, 1)).toEqual({ y: 2024, m: 4, d: 10 });
    });
});

describe('parseDateQuery', () => {
    // Fixed "now": 14 Nov 2026, noon local time.
    const NOW = new Date(2026, 10, 14, 12).getTime();
    const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

    it('reads a festival in English, Hinglish and Hindi, as every year so far', () => {
        for (const q of ['diwali photos', 'deepawali ki photo', 'दिवाली की फोटो']) {
            const dq = parseDateQuery(q, NOW)!;
            expect(dq.meaning).toEqual({ kind: 'festival', festival: 'diwali', year: undefined, latest: undefined });
            expect(dq.rest).toBe('');
            expect(dq.windows.length).toBe(2026 - 2010 + 1);
            // Newest first; Diwali 2026 (8 Nov) is already past on 14 Nov.
            expect(dq.windows[0].from).toBeLessThanOrEqual(day(2026, 11, 8));
            expect(dq.windows[0].to).toBeGreaterThan(day(2026, 11, 8));
        }
    });

    it('reads a festival with a year, or the most recent one', () => {
        const y = parseDateQuery('holi 2023', NOW)!;
        expect(y.windows).toHaveLength(1);
        expect(y.windows[0].from).toBeLessThanOrEqual(day(2023, 3, 8));
        const last = parseDateQuery('pichhli rakhi', NOW)!;
        expect(last.meaning).toMatchObject({ festival: 'rakhi', latest: true });
        expect(last.windows).toHaveLength(1);
    });

    it('leaves festivals that have not happened yet this year out', () => {
        const dq = parseDateQuery('christmas', NOW)!;
        expect(dq.windows[0].from).toBeLessThan(day(2026, 1, 1));
    });

    it('reads days, weeks, months and years, and keeps the words to look for', () => {
        expect(parseDateQuery('kal ki photo', NOW)).toMatchObject({
            rest: '',
            meaning: { kind: 'relative', relative: 'yesterday' },
            windows: [{ from: day(2026, 11, 13), to: day(2026, 11, 14) }],
        });
        expect(parseDateQuery('pichhle mahine ka bill', NOW)).toMatchObject({
            rest: 'bill',
            windows: [{ from: day(2026, 10, 1), to: day(2026, 11, 1) }],
        });
        expect(parseDateQuery('पिछले साल की रसीद', NOW)).toMatchObject({
            rest: 'रसीद',
            windows: [{ from: day(2025, 1, 1), to: day(2026, 1, 1) }],
        });
        expect(parseDateQuery('june ki photo', NOW)?.windows).toEqual([{ from: day(2026, 6, 1), to: day(2026, 7, 1) }]);
        expect(parseDateQuery('december', NOW)?.windows).toEqual([{ from: day(2025, 12, 1), to: day(2026, 1, 1) }]);
        expect(parseDateQuery('march 2024 bill', NOW)).toMatchObject({ rest: 'bill', meaning: { kind: 'month', month: 3, year: 2024 } });
        expect(parseDateQuery('2023 photos', NOW)).toMatchObject({ rest: '', meaning: { kind: 'year', year: 2023 } });
    });

    it('does not take ordinary words for dates', () => {
        expect(parseDateQuery('may i see the bill', NOW)).toBeNull();
        expect(parseDateQuery('march', NOW)).toBeNull();
        expect(parseDateQuery('bill 2023', NOW)).toBeNull();
        expect(parseDateQuery('electricity bill', NOW)).toBeNull();
        expect(parseDateQuery('', NOW)).toBeNull();
    });

    it('prefers the longest festival name', () => {
        expect(parseDateQuery('eid al adha', NOW)?.meaning).toMatchObject({ festival: 'bakrid' });
        expect(parseDateQuery('eid', NOW)?.meaning).toMatchObject({ festival: 'eid' });
    });
});
