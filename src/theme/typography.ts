import { TextStyle } from 'react-native';

/**
 * Mukta (Ek Type, SIL Open Font License) has matching Latin and Devanagari,
 * so "आधार / Aadhaar" sits on one baseline. The TTFs live in
 * android/app/src/main/assets/fonts/, where Android finds them by file name.
 *
 * Each weight is its own family, so never set `fontWeight` together with a
 * Mukta family: Android would fake-bold an already bold face.
 */
export const Fonts = {
  regular: 'Mukta-Regular',
  semibold: 'Mukta-SemiBold',
  bold: 'Mukta-Bold',
  extrabold: 'Mukta-ExtraBold',
} as const;

/**
 * Type scale. Rules:
 * - No readable text below 16sp, anywhere.
 * - Line height at least 1.4x so Hindi matras never clip.
 * - Counts that tick use `numeral` (tabular figures).
 */
export const Type = {
  display: { fontFamily: Fonts.extrabold, fontSize: 32, lineHeight: 42, letterSpacing: -0.4 },
  title: { fontFamily: Fonts.bold, fontSize: 26, lineHeight: 36 },
  heading: { fontFamily: Fonts.bold, fontSize: 21, lineHeight: 30 },
  body: { fontFamily: Fonts.regular, fontSize: 18, lineHeight: 27 },
  bodyStrong: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 26 },
  button: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 26 },
  label: { fontFamily: Fonts.semibold, fontSize: 16, lineHeight: 23 },
  labelStrong: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 23 },
  numeral: { fontFamily: Fonts.extrabold, fontSize: 40, lineHeight: 48, fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof Type;

/**
 * Text follows the phone's font size setting, capped so a 2x system size
 * doesn't break layouts. 1.5x of 18sp is 27sp.
 */
export const MAX_FONT_SCALE = 1.5;
