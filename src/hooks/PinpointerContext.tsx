import React, { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { usePinpointer } from './usePinpointer';

type PinpointerContextType = ReturnType<typeof usePinpointer>;

/** Everything usePinpointerShared() can return, for typing selectors. */
export type PinpointerState = PinpointerContextType;

/**
 * Holds the latest usePinpointer() value. The provider writes it after each
 * commit; screens read it with a selector, so a screen only re-renders when
 * the part it reads changes.
 */
interface PinpointerStore {
    get: () => PinpointerContextType;
    set: (next: PinpointerContextType) => void;
    subscribe: (listener: () => void) => () => void;
}

const createStore = (initial: PinpointerContextType): PinpointerStore => {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
        get: () => value,
        set: next => {
            if (next === value) return;
            value = next;
            listeners.forEach(listener => listener());
        },
        subscribe: listener => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
};

const PinpointerCtx = createContext<PinpointerStore | null>(null);

/** Same keys, and each value the same (Object.is). */
export const shallowEqual = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    const recA = a as Record<string, unknown>;
    const recB = b as Record<string, unknown>;
    return keysA.every(k => Object.prototype.hasOwnProperty.call(recB, k) && Object.is(recA[k], recB[k]));
};

/**
 * H7 fix: Single shared provider for usePinpointer state.
 * Prevents duplicate sync engines and native listeners when several
 * screens (the tabs stay mounted) read it at once.
 *
 * The value changes on every keystroke in search and on every photo that
 * indexing finishes. Screens that pass a selector to usePinpointerShared()
 * skip those renders unless their part changed, so the hidden tabs (Photos,
 * Papers) no longer redraw while someone types.
 */
export const PinpointerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const value = usePinpointer();
    const storeRef = useRef<PinpointerStore | null>(null);
    if (!storeRef.current) storeRef.current = createStore(value);
    const store = storeRef.current;
    // After commit, so subscribers never update while the provider renders.
    useLayoutEffect(() => {
        store.set(value);
    }, [store, value]);
    return <PinpointerCtx.Provider value={store}>{children}</PinpointerCtx.Provider>;
};

/**
 * Use this instead of usePinpointer() directly in screens.
 * Ensures a single instance of sync, search, and voice state.
 *
 * Pass a selector to re-render only when the picked part changes (compared
 * key by key), e.g. `usePinpointerShared(s => ({ syncCount: s.syncCount }))`.
 * Keep selectors at module level so they keep one identity. Without one it
 * returns the whole value and re-renders on every change.
 */
export function usePinpointerShared(): PinpointerContextType;
export function usePinpointerShared<T>(select: (state: PinpointerContextType) => T): T;
export function usePinpointerShared<T>(select?: (state: PinpointerContextType) => T): PinpointerContextType | T {
    const store = useContext(PinpointerCtx);
    if (!store) {
        throw new Error('usePinpointerShared must be used within <PinpointerProvider>');
    }
    const cache = useRef<{ state: PinpointerContextType; select: unknown; picked: T } | null>(null);
    const getSnapshot = (): PinpointerContextType | T => {
        const state = store.get();
        if (!select) return state;
        const last = cache.current;
        if (last && last.state === state && last.select === select) return last.picked;
        const picked = select(state);
        if (last && shallowEqual(last.picked, picked)) {
            cache.current = { state, select, picked: last.picked };
            return last.picked;
        }
        cache.current = { state, select, picked };
        return picked;
    };
    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
