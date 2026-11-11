import { useEffect, useState } from 'react';
import { hasFinishedFirstRun } from '../utils/FirstRun';

/** checking: still reading the flag; show: open the welcome steps; skip: go straight to Home. */
export type FirstRunGate = 'checking' | 'show' | 'skip';

/**
 * Decides once, at app start, whether to open the welcome steps. Anything
 * unexpected goes straight to Home, so nobody gets stuck in the first run.
 */
export const useFirstRunGate = (): FirstRunGate => {
  const [gate, setGate] = useState<FirstRunGate>('checking');
  useEffect(() => {
    let alive = true;
    hasFinishedFirstRun()
      .then(done => {
        if (alive) setGate(done ? 'skip' : 'show');
      })
      .catch(() => {
        if (alive) setGate('skip');
      });
    return () => {
      alive = false;
    };
  }, []);
  return gate;
};
