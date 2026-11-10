import { Easing } from 'react-native';

/**
 * Motion tokens. Rules:
 * - Motion explains what just happened; it never loops for decoration.
 *   Loops are allowed only while work is running (indexing, listening).
 * - Always `useNativeDriver: true` unless animating layout or SVG props.
 * - Reduce Motion (Android "Remove animations") turns every move into an
 *   instant change: use `useReducedMotion()` and `motionDuration()`.
 */
export const Duration = {
  press: 90, // press feedback
  quick: 160, // chips, fades, toasts
  base: 240, // sheets, results, the search ring
  slow: 360, // a photo opening, first-run moments
} as const;

export const Ease = {
  /** Entering and moving: fast start, soft landing. */
  standard: Easing.bezier(0.2, 0, 0, 1),
  /** Leaving the screen. */
  exit: Easing.bezier(0.3, 0, 1, 1),
  linear: Easing.linear,
} as const;

/** `Animated.spring` configs. */
export const Spring = {
  press: { damping: 18, stiffness: 320, mass: 1 },
  gentle: { damping: 18, stiffness: 220, mass: 1 },
} as const;

/** Staggered lists: 40ms between items, only the first 8 animate. */
export const Stagger = { step: 40, max: 8 } as const;

/** Scale of a pressed card or button. */
export const PRESS_SCALE = 0.97;

/** Duration to use, given the user's Reduce Motion setting. */
export const motionDuration = (ms: number, reduceMotion: boolean): number =>
  reduceMotion ? 0 : ms;

/** Delay for the item at `index` in a staggered list. */
export const staggerDelay = (index: number): number =>
  Math.min(Math.max(index, 0), Stagger.max) * Stagger.step;
