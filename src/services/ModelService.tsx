import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  ensureSpeechModel,
  getSpeechModelState,
  subscribeSpeechModel,
  warmUpForVoiceUsers,
  type SpeechModelState,
} from './SpeechModel';

/**
 * ModelService — the state of the on-device speech model, for the screens
 * that show it (Settings, the voice and photo search sheet).
 *
 * The Whisper model ships in the APK (download-models.js). It is loaded into
 * memory when voice search is first used; people who have used voice search
 * before get it loaded shortly after start (see services/SpeechModel.ts).
 */

/** What to tell people about voice search. */
export type VoiceStatus = 'ready' | 'loading' | 'off';

/**
 * Not loaded yet still means it works: it loads at the first tap on the mic.
 * Only a load that failed is "off".
 */
export const voiceStatusOf = (state: SpeechModelState): VoiceStatus =>
  state === 'loading' ? 'loading' : state === 'failed' ? 'off' : 'ready';

/** After start, how long to wait before loading the model for people who use voice search. */
export const VOICE_WARMUP_DELAY_MS = 3000;

interface ModelServiceState {
  isSTTDownloading: boolean;
  isTTSDownloading: boolean;
  sttDownloadProgress: number;
  ttsDownloadProgress: number;
  isSTTLoading: boolean;
  isTTSLoading: boolean;
  isSTTLoaded: boolean;
  isTTSLoaded: boolean;
  isVoiceAgentReady: boolean;
  /** Voice search in plain terms, for Settings and the helper sheet. */
  voice: VoiceStatus;
  downloadAndLoadSTT: () => Promise<void>;
  downloadAndLoadTTS: () => Promise<void>;
  downloadAndLoadAllModels: () => Promise<void>;
  unloadAllModels: () => Promise<void>;
  unloadTTSModel: () => Promise<void>;
}

const ModelServiceContext = createContext<ModelServiceState | null>(null);

export const useModelService = () => {
  const context = useContext(ModelServiceContext);
  if (!context) {
    throw new Error('useModelService must be used within ModelServiceProvider');
  }
  return context;
};

interface ModelServiceProviderProps {
  children: React.ReactNode;
}

export const ModelServiceProvider: React.FC<ModelServiceProviderProps> = ({ children }) => {
  const [speech, setSpeech] = useState<SpeechModelState>(getSpeechModelState);

  useEffect(() => {
    setSpeech(getSpeechModelState());
    return subscribeSpeechModel(setSpeech);
  }, []);

  const loadSTT = useCallback(async () => {
    await ensureSpeechModel();
  }, []);

  // The model is not loaded at start any more. Only people who have used
  // voice search get it ahead of time, after the first screen has drawn.
  useEffect(() => {
    const timer = setTimeout(() => {
      warmUpForVoiceUsers();
    }, VOICE_WARMUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const isSTTLoading = speech === 'loading';
  const isSTTLoaded = speech === 'ready';

  const noop = async () => {};

  const value: ModelServiceState = {
    isSTTDownloading: false,
    isTTSDownloading: false,
    sttDownloadProgress: 100,
    ttsDownloadProgress: 100,
    isSTTLoading,
    isTTSLoading: false,
    isSTTLoaded,
    isTTSLoaded: false,
    isVoiceAgentReady: isSTTLoaded,
    voice: voiceStatusOf(speech),
    downloadAndLoadSTT: loadSTT,
    downloadAndLoadTTS: noop,
    downloadAndLoadAllModels: loadSTT,
    unloadAllModels: noop,
    unloadTTSModel: noop,
  };

  return (
    <ModelServiceContext.Provider value={value}>
      {children}
    </ModelServiceContext.Provider>
  );
};
