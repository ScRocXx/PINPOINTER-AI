// The shared Pinpointer state for the browser preview: everything idle.
const noop = async () => {};
const state = {
  syncCount: 3400,
  totalImages: 3400,
  isSyncing: false,
  isPaused: false,
  handlePauseSync: noop,
  handleResumeSync: noop,
  isSyncingDocs: false,
  docSyncCount: 0,
  totalDocs: 0,
  lastDocSyncTime: Date.now() - 2 * 60 * 1000,
  handleDocumentSync: noop,
};
export const usePinpointerShared = () => state;
/** The real one is ReturnType<typeof usePinpointer>; the preview only fills these. */
export type PinpointerState = typeof state;
