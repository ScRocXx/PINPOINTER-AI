import { Beam, Colors, Tints } from '../colors';
import { Duration, motionDuration, Stagger, staggerDelay } from '../motion';
import { Elevation, Touch } from '../tokens';
import { MAX_FONT_SCALE, Type } from '../typography';

/** WCAG relative luminance of a #RRGGBB colour. */
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('colours', () => {
  const textPairs: Array<[string, string, string]> = [
    ['text on surface', Colors.text, Colors.surface],
    ['text on canvas', Colors.text, Colors.canvas],
    ['textSecondary on canvas', Colors.textSecondary, Colors.canvas],
    ['textMuted on surface', Colors.textMuted, Colors.surface],
    ['textMuted on canvas', Colors.textMuted, Colors.canvas],
    ['textMuted on sunken', Colors.textMuted, Colors.sunken],
    ['onPrimary on primary', Colors.onPrimary, Colors.primary],
    ['onPrimary on primaryPressed', Colors.onPrimary, Colors.primaryPressed],
    ['onPrimarySoft on primarySoft', Colors.onPrimarySoft, Colors.primarySoft],
    ['found on surface', Colors.found, Colors.surface],
    ['foundInk on foundSoft', Colors.foundInk, Colors.foundSoft],
    ['important on surface', Colors.important, Colors.surface],
    ['importantInk on importantSoft', Colors.importantInk, Colors.importantSoft],
    ['success on surface', Colors.success, Colors.surface],
    ['danger on surface', Colors.danger, Colors.surface],
    ['onPrimary on danger', Colors.onPrimary, Colors.danger],
    ['onNight on night', Colors.onNight, Colors.night],
    ['onNightMuted on night', Colors.onNightMuted, Colors.night],
  ];

  it.each(textPairs)('%s passes 4.5:1', (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.entries(Tints))('tile tint %s passes 4.5:1', (_name, tint) => {
    expect(contrast(tint.ink, tint.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('field borders are visible (3:1 on white)', () => {
    expect(contrast(Colors.lineStrong, Colors.surface)).toBeGreaterThanOrEqual(3);
  });

  it('white icons pass 3:1 on every beam stop', () => {
    Beam.colors.forEach(stop => expect(contrast(Colors.onPrimary, stop)).toBeGreaterThanOrEqual(3));
  });

  it('the beam runs cyan to violet with matching stops', () => {
    expect(Beam.colors).toHaveLength(Beam.locations.length);
    expect(Beam.locations[0]).toBe(0);
    expect(Beam.locations[Beam.locations.length - 1]).toBe(1);
  });
});

describe('type scale', () => {
  it.each(Object.entries(Type))('%s is at least 16sp with 1.2x line height', (_name, style) => {
    expect(style.fontSize).toBeGreaterThanOrEqual(16);
    expect(style.lineHeight / style.fontSize).toBeGreaterThanOrEqual(1.2);
  });

  it('body text is 18sp with room for matras', () => {
    expect(Type.body.fontSize).toBe(18);
    expect(Type.body.lineHeight / Type.body.fontSize).toBeGreaterThanOrEqual(1.4);
  });

  it('never sets fontWeight next to a Mukta family', () => {
    Object.values(Type).forEach(style => expect(style).not.toHaveProperty('fontWeight'));
  });

  it('caps font scaling at 1.5x', () => {
    expect(MAX_FONT_SCALE).toBe(1.5);
  });
});

describe('tokens and motion', () => {
  it('touch targets are never under 48dp', () => {
    expect(Touch.min).toBeGreaterThanOrEqual(48);
    expect(Touch.comfortable).toBeGreaterThanOrEqual(56);
  });

  it('shadows are boxShadow strings', () => {
    expect(Elevation.none).toEqual({});
    ['rest', 'raised', 'glow'].forEach(k =>
      expect(typeof Elevation[k as keyof typeof Elevation].boxShadow).toBe('string'),
    );
  });

  it('motionDuration turns animations off with Reduce Motion', () => {
    expect(motionDuration(Duration.base, false)).toBe(Duration.base);
    expect(motionDuration(Duration.base, true)).toBe(0);
  });

  it('staggerDelay steps 40ms and stops after 8 items', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBe(Stagger.step);
    expect(staggerDelay(3)).toBe(3 * Stagger.step);
    expect(staggerDelay(50)).toBe(Stagger.max * Stagger.step);
    expect(staggerDelay(-2)).toBe(0);
  });
});
