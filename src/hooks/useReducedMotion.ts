import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * True when the phone asks for less motion (Android: Settings → Accessibility
 * → Remove animations). Components then skip movement and show the end state.
 */
export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (alive) setReduced(!!value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => setReduced(!!value));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
};
