/**
 * jest.setup.js — global test setup for PinPointer.AI
 *
 * Runs before every test file (after the react-native preset setup).
 * Stubs the native modules the app reaches via `NativeModules` from
 * 'react-native'. Package-level native modules (ML Kit, RNFS, SQLite…)
 * are mocked via root __mocks__/ files, which jest applies automatically.
 */

global.__DEV__ = true;

// jest-native matchers (toHaveTextContent, toHaveProp, …) — optional but handy
try {
  require('@testing-library/jest-native/extend-expect');
} catch (_) {
  // @testing-library/jest-native not installed; matchers unavailable
}

// ─── NativeModules stubs ─────────────────────────────────────────────────────
// These mirror the REAL native surface used in src/:
//   EmbeddingService  → MobileCLIPModule.encodeImage / encodeText
//   DocumentPipeline  → NativePdfModule.getPdfInfo / rasterizePages / cleanupCache
//   ModelService, useVoiceRecording → SherpaOnnxModule (STT)
//   useDocumentSync, usePinpointer, screens → StorageModule
const { NativeModules } = require('react-native');

Object.assign(NativeModules, {
  MobileCLIPModule: {
    encodeImage: jest.fn(async () => []),
    encodeText: jest.fn(async () => []),
    warmUpText: jest.fn(async () => true),
    unloadText: jest.fn(async () => true),
  },
  NativePdfModule: {
    getPdfInfo: jest.fn(async () => ({ pageCount: 0, title: '' })),
    rasterizePages: jest.fn(async () => []),
    cleanupCache: jest.fn(async () => {}),
  },
  SherpaOnnxModule: {
    initSTT: jest.fn(async () => true),
    startRecognition: jest.fn(async () => true),
    stopRecognition: jest.fn(async () => ({ text: '' })),
    cancelRecognition: jest.fn(async () => true),
  },
  StorageModule: {
    openPDF: jest.fn(),
    shareImage: jest.fn(),
    openAllFilesAccessSettings: jest.fn(),
    hasAllFilesAccess: jest.fn(async () => true),
  },
});

// Suppress noisy React Native warnings that drown out real test output,
// while still letting genuine errors through.
const originalWarn = console.warn;
console.warn = (...args) => {
  const msg = String(args[0] ?? '');
  if (
    msg.includes('Animated: `useNativeDriver`') ||
    msg.includes('componentWillReceiveProps') ||
    msg.includes('VirtualizedLists should never be nested')
  ) {
    return;
  }
  originalWarn(...args);
};
