import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// One check and one listener for the whole app. Every animated part (each
// photo tile has three) used to ask Android on its own when it mounted, and
// re-render when the answer came back: hundreds of native calls and extra
// renders while a photo grid scrolled.

let reduced = false;
let generation = 0;
let subscription: { remove?: () => void } | null = null;
const listeners = new Set<() => void>();

const set = (value: boolean) => {
  if (value === reduced) return;
  reduced = value;
  listeners.forEach(listener => listener());
};

const start = () => {
  const mine = ++generation;
  AccessibilityInfo.isReduceMotionEnabled()
    .then(value => {
      if (mine === generation) set(!!value);
    })
    .catch(() => {});
  subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => set(!!value)) ?? null;
};

const stop = () => {
  generation++;
  subscription?.remove?.();
  subscription = null;
  // Read again from Android the next time something animated mounts.
  reduced = false;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
};

const getSnapshot = () => reduced;

/**
 * True when the phone asks for less motion (Android: Settings → Accessibility
 * → Remove animations). Components then skip movement and show the end state.
 */
export const useReducedMotion = (): boolean => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
