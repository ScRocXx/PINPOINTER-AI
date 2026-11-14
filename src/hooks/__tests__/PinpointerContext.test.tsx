/**
 * Tests for PinpointerContext — the single shared provider for usePinpointer
 * state (the "H7 fix" against duplicate sync engines / native listeners).
 *
 * usePinpointer itself is mocked here: these tests assert ONLY the context
 * mechanics — provider rendering, value sharing, the outside-provider error,
 * and single instantiation per provider mount.
 *
 * NOTE: @testing-library/react-native v14 made render/renderHook async —
 * every call site awaits them.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';
import { PinpointerProvider, PinpointerState, shallowEqual, usePinpointerShared } from '../PinpointerContext';

jest.mock('../usePinpointer', () => ({ usePinpointer: jest.fn() }));

import { usePinpointer } from '../usePinpointer';

const mockUsePinpointer = usePinpointer as jest.Mock;

describe('PinpointerContext', () => {
    const mockValue = {
        searchText: 'shared',
        handleScan: jest.fn(),
        isSyncing: true,
    } as unknown as ReturnType<typeof usePinpointer>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockUsePinpointer.mockReturnValue(mockValue);
    });

    test('renders children inside the provider', async () => {
        const { getByText } = await render(
            <PinpointerProvider>
                <Text>hello-child</Text>
            </PinpointerProvider>,
        );
        expect(getByText('hello-child')).toBeTruthy();
    });

    test('instantiates usePinpointer exactly once per provider mount', async () => {
        await render(
            <PinpointerProvider>
                <Text>x</Text>
            </PinpointerProvider>,
        );
        expect(mockUsePinpointer).toHaveBeenCalledTimes(1);
    });

    test('usePinpointerShared returns the provider value', async () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <PinpointerProvider>{children}</PinpointerProvider>
        );
        const { result } = await renderHook(() => usePinpointerShared(), { wrapper });
        expect(result.current).toBe(mockValue);
        expect((result.current as unknown as { searchText: string }).searchText).toBe('shared');
    });

    test('all consumers within one provider share the identical value reference', async () => {
        const seen: unknown[] = [];
        const Probe = () => {
            seen.push(usePinpointerShared());
            return null;
        };
        await render(
            <PinpointerProvider>
                <Probe />
                <Probe />
            </PinpointerProvider>,
        );
        expect(seen).toHaveLength(2);
        expect(seen[0]).toBe(seen[1]);
        expect(seen[0]).toBe(mockValue);
    });

    test('usePinpointerShared outside a provider throws the documented error', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(renderHook(() => usePinpointerShared())).rejects.toThrow(
                'usePinpointerShared must be used within <PinpointerProvider>',
            );
        } finally {
            consoleSpy.mockRestore();
        }
    });

    test('nested providers give each subtree its own instance', async () => {
        const outerValue = { tag: 'outer' } as unknown as ReturnType<typeof usePinpointer>;
        const innerValue = { tag: 'inner' } as unknown as ReturnType<typeof usePinpointer>;
        mockUsePinpointer.mockReturnValueOnce(outerValue).mockReturnValueOnce(innerValue);

        const outerSeen: unknown[] = [];
        const innerSeen: unknown[] = [];
        const OuterProbe = () => {
            outerSeen.push(usePinpointerShared());
            return null;
        };
        const InnerProbe = () => {
            innerSeen.push(usePinpointerShared());
            return null;
        };

        await render(
            <PinpointerProvider>
                <OuterProbe />
                <PinpointerProvider>
                    <InnerProbe />
                </PinpointerProvider>
            </PinpointerProvider>,
        );

        expect(mockUsePinpointer).toHaveBeenCalledTimes(2);
        expect(outerSeen[0]).toBe(outerValue);
        expect(innerSeen[0]).toBe(innerValue);
    });

    describe('selectors', () => {
        type Fake = { syncCount: number; searchText: string; act: () => void };
        const action = () => {};
        const state = (syncCount: number, searchText: string): PinpointerState =>
            ({ syncCount, searchText, act: action } as unknown as PinpointerState);
        const pickSync = (s: PinpointerState) => ({ syncCount: (s as unknown as Fake).syncCount, act: (s as unknown as Fake).act });

        // memo with no props: the parent re-rendering doesn't reach these,
        // only a change in the store does.
        const renders = { sliced: 0, whole: 0 };
        const seenSlices: Array<{ syncCount: number }> = [];
        const Sliced = React.memo(() => {
            renders.sliced++;
            seenSlices.push(usePinpointerShared(pickSync));
            return null;
        });
        const Whole = React.memo(() => {
            renders.whole++;
            usePinpointerShared();
            return null;
        });
        const tree = () => (
            <PinpointerProvider>
                <Sliced />
                <Whole />
            </PinpointerProvider>
        );

        beforeEach(() => {
            renders.sliced = 0;
            renders.whole = 0;
            seenSlices.length = 0;
        });

        test('a screen with a selector skips changes outside its slice', async () => {
            mockUsePinpointer.mockReturnValue(state(1, ''));
            const view = await render(tree());
            expect(renders).toEqual({ sliced: 1, whole: 1 });

            // Typing in search: a new value, same sync slice.
            mockUsePinpointer.mockReturnValue(state(1, 'b'));
            await view.rerender(tree());
            mockUsePinpointer.mockReturnValue(state(1, 'bi'));
            await view.rerender(tree());

            expect(renders.sliced).toBe(1);
            expect(renders.whole).toBe(3);
        });

        test('a screen with a selector re-renders when its slice changes', async () => {
            mockUsePinpointer.mockReturnValue(state(1, ''));
            const view = await render(tree());
            mockUsePinpointer.mockReturnValue(state(2, ''));
            await view.rerender(tree());

            expect(renders.sliced).toBe(2);
            expect(seenSlices[seenSlices.length - 1]).toEqual({ syncCount: 2, act: action });
        });

        test('an unchanged slice keeps its identity', async () => {
            mockUsePinpointer.mockReturnValue(state(5, ''));
            const view = await render(tree());
            const first = seenSlices[0];
            mockUsePinpointer.mockReturnValue(state(5, 'x'));
            await view.rerender(tree());
            expect(seenSlices.every(slice => slice === first)).toBe(true);
        });
    });

    describe('shallowEqual', () => {
        test('compares objects key by key', () => {
            const f = () => {};
            expect(shallowEqual({ a: 1, f }, { a: 1, f })).toBe(true);
            expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
            expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
            expect(shallowEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);
        });

        test('handles primitives and null', () => {
            expect(shallowEqual(3, 3)).toBe(true);
            expect(shallowEqual(NaN, NaN)).toBe(true);
            expect(shallowEqual(null, {})).toBe(false);
            expect(shallowEqual('a', 'b')).toBe(false);
        });
    });
});
