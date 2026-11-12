/**
 * ModelServiceProvider: the speech model is no longer loaded at app start.
 * Only people who have used voice search get it ahead of time.
 */
import React from 'react';
import { NativeModules, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('../../utils/AppLogger', () => ({
  AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { ModelServiceProvider, VOICE_WARMUP_DELAY_MS, useModelService } from '../ModelService';
import { VOICE_USED_KEY, __resetSpeechModel, ensureSpeechModel } from '../SpeechModel';

const initSTT = NativeModules.SherpaOnnxModule.initSTT as jest.Mock;

const Probe: React.FC = () => {
  const { voice, isSTTLoaded } = useModelService();
  return <Text testID="probe">{`${voice}:${isSTTLoaded}`}</Text>;
};

const renderProvider = () =>
  render(
    <ModelServiceProvider>
      <Probe />
    </ModelServiceProvider>,
  );

const afterWarmupDelay = async () => {
  await act(async () => {
    jest.advanceTimersByTime(VOICE_WARMUP_DELAY_MS + 10);
  });
  // Let the AsyncStorage read and the (mocked) load settle.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

beforeEach(() => {
  jest.useFakeTimers();
  __resetSpeechModel();
  initSTT.mockReset();
  initSTT.mockResolvedValue(true);
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ModelServiceProvider', () => {
  it('does not load the speech model at start for someone who never used voice search', async () => {
    await renderProvider();
    await afterWarmupDelay();
    expect(initSTT).not.toHaveBeenCalled();
    // Still offered as working: it loads at the first tap on the mic.
    expect(screen.getByTestId('probe').props.children).toBe('ready:false');
  });

  it('loads it shortly after start for someone who uses voice search', async () => {
    await AsyncStorage.setItem(VOICE_USED_KEY, '1');
    await renderProvider();
    expect(initSTT).not.toHaveBeenCalled(); // not before the first screen has drawn
    await afterWarmupDelay();
    expect(initSTT).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe').props.children).toBe('ready:true');
  });

  it('follows a load started elsewhere, such as the mic', async () => {
    await renderProvider();
    await act(async () => {
      await ensureSpeechModel();
    });
    expect(screen.getByTestId('probe').props.children).toBe('ready:true');
  });

  it('shows a failed load as off', async () => {
    initSTT.mockRejectedValueOnce(new Error('out of memory'));
    await renderProvider();
    await act(async () => {
      await ensureSpeechModel();
    });
    expect(screen.getByTestId('probe').props.children).toBe('off:false');
  });
});
