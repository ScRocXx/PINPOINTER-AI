/**
 * Pinpointer colours.
 *
 * `Colors` is the launch palette: light, high-contrast, with the brand's cyan
 * and violet used only where something is being found (see `Beam`). Every text
 * pair below passes WCAG 4.5:1; `textMuted` is the lightest text allowed.
 * The design concept lives at https://claude.ai/artifact/5J9fnr87FASsXKzmC6j82E
 *
 * `AppColors` is the old dark "deep space" palette. It stays only until every
 * screen has moved to `Colors`; don't use it in new code.
 */

/** Raw swatches. Screens use the semantic `Colors` names, not these. */
export const Palette = {
  ink900: '#16131F',
  ink700: '#4A4659',
  ink500: '#69657A',
  ink400: '#8C88A0',
  ink300: '#C9C4D6',
  ink200: '#E2DFEA',
  ink100: '#EFEDF5',
  ink50: '#F6F5FA',
  white: '#FFFFFF',
  night: '#0E0C14',

  violet700: '#4A31C4',
  violet600: '#5A3FE0',
  violet100: '#EEEAFE',

  blue500: '#3C6FE0',

  cyan800: '#0A4F5A',
  cyan700: '#0A6F7F',
  cyan500: '#10A2B7', // the beam's first stop; white icons on it pass 3:1
  cyan100: '#DDF6F8',

  marigold800: '#9A5100',
  marigold700: '#B25E00',
  marigold400: '#F29D1B',
  marigold100: '#FFF1DB',

  green700: '#1C7A4A',
  green100: '#E3F2E8',

  red700: '#B3261E',
  red100: '#FBE9E7',
} as const;

/** Semantic colours for the light theme. */
export const Colors = {
  // Surfaces
  canvas: Palette.ink50, // screen background
  surface: Palette.white, // cards, sheets, the search field
  sunken: Palette.ink100, // pressed rows, empty thumbnails, tonal buttons
  night: Palette.night, // photo viewer background
  scrim: 'rgba(14,12,20,0.56)',

  // Text and icons
  text: Palette.ink900, // 18.3:1 on white
  textSecondary: Palette.ink700, // 9.1:1
  textMuted: Palette.ink500, // 5.6:1 on white, 5.2:1 on canvas. Lightest text allowed.
  onPrimary: Palette.white,
  onNight: Palette.white,
  onNightMuted: '#C9C6D6',

  // Lines
  line: Palette.ink200, // dividers (decorative)
  lineStrong: Palette.ink400, // field and chip borders, 3.4:1

  // Brand and interaction
  primary: Palette.violet600, // buttons, active tab, links. White on it is 6.5:1
  primaryPressed: Palette.violet700,
  primarySoft: Palette.violet100, // selected chips
  onPrimarySoft: Palette.violet700, // 7.1:1 on primarySoft

  // "Found": matches, highlights, privacy
  found: Palette.cyan700, // 5.8:1
  foundSoft: Palette.cyan100,
  foundInk: Palette.cyan800, // highlighted words on foundSoft

  // "Important / ज़रूरी"
  important: Palette.marigold700, // 4.7:1
  importantInk: Palette.marigold800, // 5.3:1 on importantSoft
  importantSoft: Palette.marigold100,
  importantStar: Palette.marigold400, // star fill only, never text

  // Status
  success: Palette.green700,
  successSoft: Palette.green100,
  danger: Palette.red700,
  dangerSoft: Palette.red100,
} as const;

export type ColorName = keyof typeof Colors;

/**
 * The beam: Pinpointer's cyan-to-violet gradient. Use it only on things that
 * find (the search ring, progress, the Scan button, the mic, the mark), never
 * as a fill behind words. White icons on it pass 3:1.
 */
export const Beam = {
  colors: [Palette.cyan500, Palette.blue500, Palette.violet600],
  locations: [0, 0.58, 1],
  start: { x: 0, y: 0.3 },
  end: { x: 1, y: 0.7 },
} as const;

/** Tile tints for categories (background + matching ink, all 4.5:1+). */
export const Tints = {
  id: { bg: Palette.marigold100, ink: Palette.marigold800 },
  bill: { bg: Palette.violet100, ink: Palette.violet700 },
  medicine: { bg: Palette.green100, ink: Palette.green700 },
  bank: { bg: Palette.cyan100, ink: Palette.cyan700 },
  screenshot: { bg: Palette.ink100, ink: Palette.ink900 },
  family: { bg: Palette.marigold100, ink: Palette.marigold800 },
  other: { bg: Palette.ink100, ink: Palette.ink900 },
} as const;

export type TintName = keyof typeof Tints;

/**
 * Legacy dark palette ("deep space"). Only the screens that haven't been
 * restyled yet use it. Delete it once the last one moves to `Colors`.
 * @deprecated Use `Colors`.
 */
export const AppColors = {
  primaryDark: '#0A0E1A',
  primaryMid: '#141B2D',
  surfaceCard: '#1C2438',
  surfaceElevated: '#242F4A',

  accentCyan: '#00D9FF',
  accentViolet: '#8B5CF6',
  accentPink: '#EC4899',
  accentGreen: '#10B981',
  accentOrange: '#F59E0B',

  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',

  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
} as const;

export type AppColorsType = typeof AppColors;
