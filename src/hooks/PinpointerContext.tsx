import React, { createContext, useContext } from 'react';
import { usePinpointer } from './usePinpointer';

type PinpointerContextType = ReturnType<typeof usePinpointer>;

const PinpointerCtx = createContext<PinpointerContextType | null>(null);

/**
 * H7 fix: Single shared provider for usePinpointer state.
 * Prevents duplicate sync engines and native listeners when
 * both HomeScreen and PinpointerScreen are in the nav stack.
 */
export const PinpointerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const value = usePinpointer();
    return <PinpointerCtx.Provider value={value}>{children}</PinpointerCtx.Provider>;
};

/**
 * Use this instead of usePinpointer() directly in screens.
 * Ensures a single instance of sync, search, and voice state.
 */
export const usePinpointerShared = (): PinpointerContextType => {
    const ctx = useContext(PinpointerCtx);
    if (!ctx) {
        throw new Error('usePinpointerShared must be used within <PinpointerProvider>');
    }
    return ctx;
};
