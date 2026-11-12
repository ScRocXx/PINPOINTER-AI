/**
 * SpeechModel: the speech model loads on first use, once, and only people
 * who have used voice search get it loaded ahead of time.
 */
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../utils/AppLogger', () => ({
  AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  VOICE_USED_KEY,
  __resetSpeechModel,
  ensureSpeechModel,
  getSpeechModelState,
  noteVoiceSearchUsed,
  subscribeSpeechModel,
  warmUpForVoiceUsers,
} from '../SpeechModel';
import { voiceStatusOf } from '../ModelService';

const initSTT = NativeModules.SherpaOnnxModule.initSTT as jest.Mock;

beforeEach(() => {
  __resetSpeechModel();
  initSTT.mockReset();
  initSTT.mockResolvedValue(true);
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
});

describe('ensureSpeechModel', () => {
  it('does not load anything until asked', () => {
    expect(getSpeechModelState()).toBe('idle');
    expect(initSTT).not.toHaveBeenCalled();
  });

  it('loads the model once and reports each step', async () => {
    const seen: string[] = [];
    subscribeSpeechModel((s) => seen.push(s));
    expect(await ensureSpeechModel()).toBe(true);
    expect(seen).toEqual(['loading', 'ready']);
    expect(await ensureSpeechModel()).toBe(true);
    expect(initSTT).toHaveBeenCalledTimes(1);
  });

  it('shares one load between callers that ask at the same time', async () => {
    let finish!: (v: boolean) => void;
    initSTT.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    const first = ensureSpeechModel();
    const second = ensureSpeechModel();
    expect(getSpeechModelState()).toBe('loading');
    finish(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(initSTT).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load and tries again next time', async () => {
    initSTT.mockRejectedValueOnce(new Error('out of memory'));
    expect(await ensureSpeechModel()).toBe(false);
    expect(getSpeechModelState()).toBe('failed');
    expect(await ensureSpeechModel()).toBe(true);
    expect(getSpeechModelState()).toBe('ready');
    expect(initSTT).toHaveBeenCalledTimes(2);
  });

  it('stops telling a listener that unsubscribed', async () => {
    const listener = jest.fn();
    subscribeSpeechModel(listener)();
    await ensureSpeechModel();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('warmUpForVoiceUsers', () => {
  it('leaves the model unloaded for someone who never used voice search', async () => {
    expect(await warmUpForVoiceUsers()).toBe(false);
    expect(initSTT).not.toHaveBeenCalled();
    expect(getSpeechModelState()).toBe('idle');
  });

  it('loads it ahead of time once voice search has been used', async () => {
    await noteVoiceSearchUsed();
    expect(await AsyncStorage.getItem(VOICE_USED_KEY)).toBe('1');
    expect(await warmUpForVoiceUsers()).toBe(true);
    await ensureSpeechModel();
    expect(initSTT).toHaveBeenCalledTimes(1);
    expect(getSpeechModelState()).toBe('ready');
  });

  it('does not load when the saved flag cannot be read', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await warmUpForVoiceUsers()).toBe(false);
    expect(initSTT).not.toHaveBeenCalled();
  });
});

describe('voiceStatusOf', () => {
  it('tells people voice search works before it is loaded, and only a failed load is off', () => {
    expect(voiceStatusOf('idle')).toBe('ready');
    expect(voiceStatusOf('ready')).toBe('ready');
    expect(voiceStatusOf('loading')).toBe('loading');
    expect(voiceStatusOf('failed')).toBe('off');
  });
});
