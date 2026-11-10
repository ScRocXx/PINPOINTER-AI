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
