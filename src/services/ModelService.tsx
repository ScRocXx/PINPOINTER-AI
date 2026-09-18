import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { NativeModules } from 'react-native';
import { AppLogger } from '../utils/AppLogger';

const { SherpaOnnxModule } = NativeModules;

/**
 * ModelService — Initializes sherpa-onnx STT model on app mount.
 *
 * The whisper model is bundled in the APK assets (downloaded at build time by download-models.js).
 * "Loading" here means loading model weights into memory — typically 1-3 seconds.
 */

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
  const [isSTTLoading, setIsSTTLoading] = useState(true);
  const [isSTTLoaded, setIsSTTLoaded] = useState(false);

  // Initialize STT model
  const loadSTT = useCallback(async () => {
    try {
      setIsSTTLoading(true);
      AppLogger.info('ModelService', 'Initializing STT (Whisper Base)...');
      await SherpaOnnxModule.initSTT();
      setIsSTTLoaded(true);
      AppLogger.info('ModelService', 'STT initialized successfully');
    } catch (error) {
      AppLogger.error('ModelService', 'Failed to init STT', error);
      setIsSTTLoaded(false);
    } finally {
      setIsSTTLoading(false);
    }
  }, []);

  // Initialize on mount with delay — let the UI render first before heavy model loading
  useEffect(() => {
    const timer = setTimeout(() => {
      loadSTT();
    }, 3000);
    return () => clearTimeout(timer);
  }, [loadSTT]);

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

// No-op: models are bundled in assets, no registration needed
export const registerDefaultModels = async () => {};
