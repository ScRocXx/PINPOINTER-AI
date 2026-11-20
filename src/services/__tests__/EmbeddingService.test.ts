import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { areClipModelsAvailable } from '../EmbeddingService';

const setOS = (os: 'android' | 'ios') => Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
const existsAssets = RNFS.existsAssets as jest.Mock;

describe('areClipModelsAvailable', () => {
  const realOS = Platform.OS;
  beforeEach(() => {
    setOS('android');
    existsAssets.mockReset().mockResolvedValue(true);
  });
  afterAll(() => setOS(realOS as 'android' | 'ios'));

  it('is true when both photo search models ship in the app', async () => {
    await expect(areClipModelsAvailable()).resolves.toBe(true);
    expect(existsAssets).toHaveBeenCalledWith('models/clip/vision_encoder_int8.onnx');
    expect(existsAssets).toHaveBeenCalledWith('models/clip/text_encoder_int8.onnx');
  });

  it('is false when one is missing', async () => {
    existsAssets.mockImplementation(async (path: string) => !path.includes('text_encoder'));
    await expect(areClipModelsAvailable()).resolves.toBe(false);
  });

  it('is false when the check itself fails', async () => {
    existsAssets.mockRejectedValue(new Error('no assets'));
    await expect(areClipModelsAvailable()).resolves.toBe(false);
  });

  it('trusts the native module off Android', async () => {
    setOS('ios');
    await expect(areClipModelsAvailable()).resolves.toBe(true);
    expect(existsAssets).not.toHaveBeenCalled();
  });
});

describe('areClipModelsAvailable without the native module', () => {
  it('is false', async () => {
    jest.resetModules();
    const { NativeModules } = require('react-native');
    const saved = NativeModules.MobileCLIPModule;
    delete NativeModules.MobileCLIPModule;
    try {
      const fresh = require('../EmbeddingService') as typeof import('../EmbeddingService');
      await expect(fresh.areClipModelsAvailable()).resolves.toBe(false);
    } finally {
      NativeModules.MobileCLIPModule = saved;
    }
  });
});

describe('text model lifetime', () => {
  const { NativeModules } = require('react-native');
  const clip = () => NativeModules.MobileCLIPModule as Record<string, jest.Mock>;
  // The cache and the countdown are module-level: reset them per test.
  const svc = jest.requireActual('../EmbeddingService') as typeof import('../EmbeddingService');

  beforeEach(() => {
    jest.useFakeTimers();
    svc.__resetTextModelState();
    svc.__clearTextCache();
    clip().warmUpText.mockClear().mockResolvedValue(true);
    clip().unloadText.mockClear().mockResolvedValue(true);
    clip().encodeText.mockClear().mockResolvedValue([0.1, 0.2]);
  });

  afterEach(() => {
    svc.__resetTextModelState();
    jest.useRealTimers();
  });

  it('is not loaded until search warms it up, then tells listeners', async () => {
    const ready = jest.fn();
    svc.onTextModelReady(ready);
    expect(svc.isTextModelReady()).toBe(false);
    await svc.warmUpText();
    expect(svc.isTextModelReady()).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    // Already loaded: warming up again doesn't announce it again.
    await svc.warmUpText();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('frees the model after 10 minutes without a search', async () => {
    await svc.warmUpText();
    await jest.advanceTimersByTimeAsync(svc.TEXT_IDLE_UNLOAD_MS - 1000);
    expect(clip().unloadText).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(clip().unloadText).toHaveBeenCalledTimes(1);
    expect(svc.isTextModelReady()).toBe(false);
  });

  it('each search restarts the 10 minutes, even one answered from the cache', async () => {
    await svc.encodeText('cat');
    await jest.advanceTimersByTimeAsync(9 * 60 * 1000);
    await svc.encodeText('dog');
    await jest.advanceTimersByTimeAsync(9 * 60 * 1000);
    await svc.encodeText('cat'); // cached: no model call, still counts as a search
    expect(clip().encodeText).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(clip().unloadText).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(clip().unloadText).toHaveBeenCalledTimes(1);
  });

  it('the next search after an unload loads it again and tells listeners again', async () => {
    const ready = jest.fn();
    svc.onTextModelReady(ready);
    await svc.encodeText('cat');
    await jest.advanceTimersByTimeAsync(svc.TEXT_IDLE_UNLOAD_MS);
    expect(svc.isTextModelReady()).toBe(false);
    await svc.encodeText('bill');
    expect(svc.isTextModelReady()).toBe(true);
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it('a cached query after an unload does not start a countdown for a model that is not there', async () => {
    await svc.encodeText('cat');
    await jest.advanceTimersByTimeAsync(svc.TEXT_IDLE_UNLOAD_MS);
    await svc.encodeText('cat');
    await jest.advanceTimersByTimeAsync(svc.TEXT_IDLE_UNLOAD_MS);
    expect(clip().unloadText).toHaveBeenCalledTimes(1);
  });

  it('copes with an older app build without unloadText, and with an unload error', async () => {
    const saved = clip().unloadText;
    delete (NativeModules.MobileCLIPModule as Record<string, unknown>).unloadText;
    try {
      await svc.warmUpText();
      await jest.advanceTimersByTimeAsync(svc.TEXT_IDLE_UNLOAD_MS);
      expect(svc.isTextModelReady()).toBe(false);
    } finally {
      NativeModules.MobileCLIPModule.unloadText = saved;
    }
    clip().unloadText.mockRejectedValue(new Error('busy'));
    await svc.warmUpText();
    await jest.advanceTimersByTimeAsync(svc.TEXT_IDLE_UNLOAD_MS);
    expect(svc.isTextModelReady()).toBe(false);
  });
});
