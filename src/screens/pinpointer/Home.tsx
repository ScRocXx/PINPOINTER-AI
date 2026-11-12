import React, { useCallback } from 'react';
import { Linking, NativeModules } from 'react-native';
import { useToast } from '../../components/ui';
import { useStrings } from '../../i18n';
import { usePinpointerShared } from '../../hooks/PinpointerContext';
import { useHomeOverview } from '../../hooks/useHomeOverview';
import type { IndexingProgress } from '../../hooks/useIndexingProgress';
import { usePinnedItems } from '../../hooks/usePinnedItems';
import { AppLogger } from '../../utils/AppLogger';
import type { CollectionId } from '../../utils/Collections';
import { forgetIfGone } from '../../utils/MissingFiles';
import type { PinnedItem } from '../../utils/PinnedItems';
import { HomeView } from './HomeView';
import { TILE_LOOK } from './HomeParts';

export interface HomeProps {
  /** Open a photo in the viewer (the screen also remembers it as recent). */
  onOpenImage: (uri: string) => void;
  /** What is being got ready right now, whoever started it. */
  progress: IndexingProgress;
}

const noop = () => {};

/** Open a PDF in the phone's PDF app. */
const openPaper = (filePath: string) => {
  const { StorageModule } = NativeModules;
  if (StorageModule?.openPDF) {
    StorageModule.openPDF(filePath.replace('file://', ''));
    return;
  }
  Linking.openURL(filePath).catch(e => AppLogger.error('Home', 'Could not open the paper', e));
};

/**
 * Home's wiring: the shared Pinpointer state, the Important stars and the
 * Home overview (tiles, photo totals, recent photos) into `HomeView`.
 */
export const Home: React.FC<HomeProps> = ({ onOpenImage, progress }) => {
  const { t } = useStrings();
  const toast = useToast();
  const {
    setSearchText,
    setIsSearching,
    isRecording,
    isTranscribing,
    isModelLoading,
    startListening,
    stopListening,
    isSyncing,
    isPaused,
    isDeepSync,
    syncCount,
    lastSyncTime,
    handleQuickSync,
    handleDeepSync,
    handlePauseSync,
    handleResumeSync,
    lastDocSyncTime,
    handleDocumentSync,
  } = usePinpointerShared();
  const { items: pinned, toggle } = usePinnedItems();
  // The queue itself says what is running: a check started by the first run
  // or while charging shows here too, not only one started from this screen.
  const photosRunning = progress.photos.running;
  const papersRunning = progress.papers.running;
  const overview = useHomeOverview({
    busy: photosRunning || papersRunning,
    progressTick: progress.photos.done + progress.papers.done,
  });

  const openSearch = useCallback(
    (query?: string) => {
      if (query !== undefined) setSearchText(query);
      setIsSearching(true);
    },
    [setIsSearching, setSearchText],
  );

  const onOpenCollection = useCallback(
    (id: CollectionId) => openSearch(t(TILE_LOOK[id].labelKey)),
    [openSearch, t],
  );

  const onCheck = useCallback(
    (everything: boolean) => {
      if (everything) handleDeepSync();
      else handleQuickSync();
      // New papers too, but quietly: "Check again" must not open a pop-up
      // about PDFs every time for someone who chose not to allow them.
      handleDocumentSync(50, false, false);
    },
    [handleDeepSync, handleDocumentSync, handleQuickSync],
  );

  const onOpenPinned = useCallback(
    async (item: PinnedItem) => {
      // A starred file that was deleted leaves the shelf and the index.
      if (await forgetIfGone(item.uri, item.kind)) {
        toast.show(t('error.fileGone'), { icon: 'alert' });
        toggle(item);
        return;
      }
      if (item.kind === 'DOCUMENT') openPaper(item.uri);
      else onOpenImage(item.uri);
    },
    [onOpenImage, t, toast, toggle],
  );

  return (
    <HomeView
      onOpenSearch={() => openSearch()}
      onVoicePress={isModelLoading ? noop : isRecording ? stopListening : startListening}
      listening={isRecording}
      understanding={isTranscribing}
      photos={{
        running: photosRunning,
        paused: isPaused && !photosRunning,
        // "Check again" from here looks at the newest photos only.
        quick: progress.photos.quick && isSyncing && !isDeepSync,
        processed: syncCount,
        checked: progress.photos.done,
        total: progress.photos.total ?? overview.photoTotal,
        lastChecked: lastSyncTime,
      }}
      papers={{
        running: papersRunning,
        done: papersRunning ? progress.papers.done : 0,
        total: papersRunning ? progress.papers.total ?? 0 : 0,
        lastChecked: lastDocSyncTime,
      }}
      onCheck={onCheck}
      onPause={handlePauseSync}
      onResume={handleResumeSync}
      collections={overview.collections}
      onOpenCollection={onOpenCollection}
      pinned={pinned}
      onOpenPinned={onOpenPinned}
      recent={overview.recent}
      onOpenPhoto={onOpenImage}
    />
  );
};
