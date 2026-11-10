import { en, formatCount, hi, languageFromLocale, relativeTime, StringKey, translate } from '../strings';

const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();

describe('dictionaries', () => {
  const keys = Object.keys(en) as StringKey[];

  it('Hindi has every English key and nothing extra', () => {
    expect(Object.keys(hi).sort()).toEqual([...keys].sort());
  });

  it.each(keys)('%s keeps the same placeholders in Hindi', key => {
    expect(placeholders(hi[key])).toEqual(placeholders(en[key]));
  });

  it('no string is empty', () => {
    keys.forEach(key => {
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(hi[key].trim().length).toBeGreaterThan(0);
    });
  });

  it('language names are written in their own script', () => {
    expect(en['lang.hi']).toBe(hi['lang.hi']);
    expect(en['lang.en']).toBe(hi['lang.en']);
  });

  it('keeps the old jargon out of the words people see', () => {
    const banned = /universal sync|ocr|vault|smart clipboard|index|ai-classified/i;
    keys.forEach(key => expect(en[key]).not.toMatch(banned));
  });
});

describe('translate', () => {
  it('fills placeholders and groups numbers the Indian way', () => {
    expect(translate('en', 'progress.countShort', { done: 1240, total: 124000 })).toBe('1,240 of 1,24,000');
  });

  it('leaves unknown placeholders alone', () => {
    expect(translate('en', 'collection.count', {})).toBe('{n} found');
  });

  it('returns Hindi when asked', () => {
    expect(translate('hi', 'tab.home')).toBe(hi['tab.home']);
    expect(translate('hi', 'tab.home')).not.toBe(en['tab.home']);
  });

  it('passes strings through untouched', () => {
    expect(translate('en', 'search.nothingTitle', { q: 'aadhaar' })).toBe('Nothing found for “aadhaar” yet');
  });
});

describe('formatCount', () => {
  it('groups lakhs', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(3400)).toBe('3,400');
    expect(formatCount(1234567)).toBe('12,34,567');
  });
});

describe('languageFromLocale', () => {
  it('starts Hindi phones in Hindi', () => {
    expect(languageFromLocale('hi_IN')).toBe('hi');
    expect(languageFromLocale('hi-IN')).toBe('hi');
    expect(languageFromLocale('HI')).toBe('hi');
  });
  it('defaults to English', () => {
    expect(languageFromLocale('en_IN')).toBe('en');
    expect(languageFromLocale('ta_IN')).toBe('en');
    expect(languageFromLocale(undefined)).toBe('en');
    expect(languageFromLocale(null)).toBe('en');
  });
});

describe('relativeTime', () => {
  const now = 1_700_000_000_000;
  const ago = (secs: number) => relativeTime('en', now - secs * 1000, now);

  it('says never for no timestamp', () => {
    expect(relativeTime('en', null, now)).toBe('never');
    expect(relativeTime('en', 0, now)).toBe('never');
  });
  it('covers each range', () => {
    expect(ago(5)).toBe('just now');
    expect(ago(-30)).toBe('just now');
    expect(ago(60 * 5)).toBe('5 min ago');
    expect(ago(3600 + 60)).toBe('1 hour ago');
    expect(ago(3600 * 5)).toBe('5 hours ago');
    expect(ago(86400 + 10)).toBe('yesterday');
    expect(ago(86400 * 4)).toBe('4 days ago');
  });
  it('speaks Hindi too', () => {
    expect(relativeTime('hi', now - 300_000, now)).toBe(translate('hi', 'time.minutesAgo', { n: 5 }));
  });
});
