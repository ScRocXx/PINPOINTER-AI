import { alsoSearchedAs, firstMatchIndex, matchTermsIn, snippetFrom } from '../MatchTerms';

describe('alsoSearchedAs', () => {
  test('an English or Hinglish word also searches its Hindi word and another spelling', () => {
    const alt = alsoSearchedAs('aadhaar');
    expect(alt).toContain('आधार');
    expect(alt).toContain('aadhar');
    expect(alt).not.toContain('aadhaar');
  });

  test('a Hinglish word brings its Hindi and English words', () => {
    const alt = alsoSearchedAs('bijli');
    expect(alt[0]).toBe('बिजली');
    expect(alt).toContain('electricity');
  });

  test('a Hindi word brings its Roman spelling and an English word', () => {
    const alt = alsoSearchedAs('दवाई');
    expect(alt.length).toBeGreaterThanOrEqual(2);
    expect(alt[0]).toMatch(/^da[vw]a/);
    expect(alt).toContain('medicine');
  });

  test('never repeats what was typed, never more than the limit', () => {
    expect(alsoSearchedAs('bijli bill dawai', 3)).toHaveLength(3);
    const alt = alsoSearchedAs('bill बिल');
    expect(alt.map(a => a.toLowerCase())).not.toContain('bill');
    expect(alt).not.toContain('बिल');
  });

  test('unknown words and empty queries give nothing to show', () => {
    expect(alsoSearchedAs('zxqv')).toEqual([]);
    expect(alsoSearchedAs('')).toEqual([]);
    expect(alsoSearchedAs('a')).toEqual([]);
  });

  test('a plural is not shown as another word', () => {
    expect(alsoSearchedAs('medicine')).not.toContain('medicines');
  });
});

describe('matchTermsIn', () => {
  test('finds the typed word and words that start with it', () => {
    expect(matchTermsIn('Electricity Bill for October', 'bill')).toEqual(['Bill']);
    expect(matchTermsIn('Aadhaar card front', 'aadh')).toEqual(['Aadhaar']);
  });

  test('filler words and "photo of" are not marked or offered as other spellings', () => {
    expect(matchTermsIn('Photo of the office', 'photo of biryani')).toEqual([]);
    expect(matchTermsIn('biryani order of today', 'photo of biryani')).toEqual(['biryani']);
    expect(alsoSearchedAs('photo of biryani')).toEqual([]);
  });

  test('finds the same word in Hindi for a Roman query (sound)', () => {
    expect(matchTermsIn('भारत सरकार आधार कार्ड', 'aadhaar')).toContain('आधार');
  });

  test('finds the Roman word for a Hindi query', () => {
    expect(matchTermsIn('Your aadhaar number', 'आधार')).toContain('aadhaar');
  });

  test('finds words with the same meaning', () => {
    expect(matchTermsIn('Take 2 tablets after food', 'dawai')).toContain('tablets');
    expect(matchTermsIn('बिजली बिल', 'electricity')).toContain('बिजली');
  });

  test('lists each word once, in text order', () => {
    expect(matchTermsIn('bill no. 4 · Bill total · BILL', 'bill')).toEqual(['bill']);
  });

  test('single letters and empty input match nothing', () => {
    expect(matchTermsIn('a big apple', 'a')).toEqual([]);
    expect(matchTermsIn('', 'bill')).toEqual([]);
    expect(matchTermsIn('some text', '')).toEqual([]);
  });

  test('digits match the masked number they end', () => {
    expect(matchTermsIn('Aadhaar ****-****-4821', '4821')).toEqual(['4821']);
  });
});

describe('snippetFrom', () => {
  test('starts at the first matched word', () => {
    expect(snippetFrom('Government of India · Aadhaar ****-****-4821', ['Aadhaar'])).toBe('Aadhaar ****-****-4821');
  });

  test('keeps the start when nothing matches, and flattens lines', () => {
    expect(snippetFrom('Line one\n\nline   two', ['zzz'])).toBe('Line one line two');
  });

  test('cuts long text with an ellipsis', () => {
    const s = snippetFrom(`bill ${'x'.repeat(300)}`, ['bill'], 20);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(21);
  });

  test('empty text gives an empty snippet', () => {
    expect(snippetFrom('', ['bill'])).toBe('');
  });
});

describe('firstMatchIndex', () => {
  test('earliest of several terms, any case', () => {
    expect(firstMatchIndex('One BILL and a receipt', ['receipt', 'bill'])).toBe(4);
    expect(firstMatchIndex('nothing here', ['bill', ''])).toBe(-1);
  });
});
