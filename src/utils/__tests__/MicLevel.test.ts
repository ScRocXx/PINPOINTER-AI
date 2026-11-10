import { NativeEventEmitter } from 'react-native';
import {
  MAX_LISTEN_MS,
  MIC_LEVEL_EVENT,
  NO_SPEECH_MS,
  SILENCE_MS,
  createSilenceDetector,
  subscribeMicLevel,
} from '../MicLevel';

describe('createSilenceDetector', () => {
  test('keeps listening while the person speaks, stops after a pause', () => {
    const d = createSilenceDetector(0);
    expect(d.push(0.8, 300)).toBe('listen');
    expect(d.heardSpeech()).toBe(true);
    expect(d.push(0.1, 300 + SILENCE_MS - 1)).toBe('listen');
    expect(d.push(0.1, 300 + SILENCE_MS)).toBe('stop');
  });

  test('speaking again resets the pause', () => {
    const d = createSilenceDetector(0);
    d.push(0.8, 100);
    d.push(0.1, 1000);
    d.push(0.9, 1500);
    expect(d.push(0.1, 1500 + SILENCE_MS - 100)).toBe('listen');
  });

  test('cancels when nothing is said', () => {
    const d = createSilenceDetector(1000);
    expect(d.push(0.1, 1000 + NO_SPEECH_MS - 1)).toBe('listen');
    expect(d.push(0.1, 1000 + NO_SPEECH_MS)).toBe('cancel');
    expect(d.heardSpeech()).toBe(false);
  });

  test('stops at the time limit even while still loud', () => {
    const d = createSilenceDetector(0);
    d.push(0.9, 100);
    expect(d.push(0.9, MAX_LISTEN_MS)).toBe('stop');
  });

  test('thresholds can be tuned', () => {
    const d = createSilenceDetector(0, { speechLevel: 0.6, silenceMs: 500 });
    expect(d.push(0.5, 100)).toBe('listen');
    expect(d.heardSpeech()).toBe(false);
    d.push(0.7, 200);
    expect(d.push(0.1, 700)).toBe('stop');
  });
});

describe('subscribeMicLevel', () => {
  afterEach(() => jest.restoreAllMocks());

  test('passes clamped levels and unsubscribes', () => {
    let handler: ((e: unknown) => void) | undefined;
    const remove = jest.fn();
    const spy = jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation(((event: string, fn: (e: unknown) => void) => {
        if (event === MIC_LEVEL_EVENT) handler = fn;
        return { remove };
      }) as unknown as typeof NativeEventEmitter.prototype.addListener);
    const seen: number[] = [];
    const stop = subscribeMicLevel(l => seen.push(l));
    expect(spy).toHaveBeenCalledWith(MIC_LEVEL_EVENT, expect.any(Function));

    handler?.({ level: 0.42 });
    handler?.({ level: 7 });
    handler?.({ level: -1 });
    handler?.({ level: Number.NaN });
    handler?.(undefined);
    expect(seen).toEqual([0.42, 1, 0, 0, 0]);

    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
