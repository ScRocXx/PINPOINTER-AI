import { ViewStyle } from 'react-native';

/** Spacing on a 4dp grid. */
export const Space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

/** Left and right padding of every screen. */
export const GUTTER = Space.xl;

/** Corner radii. */
export const Radius = {
  xs: 10, // small badges, thumbnails inside rows
  sm: 16, // buttons, fields, thumbnails
  md: 22, // cards
  lg: 28, // sheets
  pill: 999, // chips, tags, round buttons
} as const;

/**
 * Touch targets. Main actions are 56dp (bigger than Android's 48dp, for
 * unsteady hands); nothing tappable is smaller than 48dp.
 */
export const Touch = {
  min: 48,
  comfortable: 56,
  fab: 62,
} as const;

/** @deprecated Use `Touch.comfortable`. Kept for the drafted tokens. */
export const TOUCH_MIN = Touch.comfortable;

/** Extra hit area for small visuals inside a 48dp+ target. */
export const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

/**
 * Shadows, tinted violet instead of grey-black.
 * - rest: cards and rows
 * - raised: the search field, sheets, floating cards
 * - glow: the Scan button only
 * `boxShadow` needs Android 9+; older phones show no shadow, so cards also
 * keep a hairline border where separation matters.
 */
export const Elevation: Record<'none' | 'rest' | 'raised' | 'glow', ViewStyle> = {
  none: {},
  rest: { boxShadow: '0px 1px 2px rgba(22, 19, 31, 0.07)' },
  raised: { boxShadow: '0px 8px 24px rgba(54, 38, 140, 0.12)' },
  glow: { boxShadow: '0px 10px 24px rgba(90, 63, 224, 0.34)' },
};

/** Fixed sizes shared by several screens. */
export const Layout = {
  tabBarHeight: 72, // plus the bottom safe-area inset
  headerHeight: 56,
  searchFieldHeight: 60,
  thumbnail: 112,
} as const;
