import React, { useState } from 'react';
import { ModelDownloadSheet } from '../components/ModelDownloadSheet';
import { useDocumentAccess, usePhotoAccess } from '../hooks/useStorageAccess';
import { useModelService } from '../services/ModelService';
import { allFilesAccessApplies } from '../utils/StoragePermissions';
import { SettingsView } from './SettingsView';

export { SettingsView } from './SettingsView';
export type { SettingsViewProps } from './SettingsView';

/**
 * Settings: language, what Pinpointer can see (photos, PDFs), voice and
 * photo search (the helper sheet), what Pinpointer does with your photos,
 * and the version.
 */
export const SettingsScreen: React.FC = () => {
  const photos = usePhotoAccess();
  const docs = useDocumentAccess();
  const { isSTTLoaded, isSTTLoading } = useModelService();
  const [helpersOpen, setHelpersOpen] = useState(false);

  return (
    <SettingsView
      photoAccess={photos.access}
      docAccess={docs.access}
      voice={isSTTLoaded ? 'ready' : isSTTLoading ? 'loading' : 'off'}
      // All photos: only Settings can change it. Otherwise Android's own
      // dialog, unless Android won't show it any more.
      onChangePhotos={() =>
        photos.access === 'full' || photos.access === 'blocked' ? photos.openSettings() : photos.request()
      }
      // Android 11+: the All files switch (also to turn it off), or a folder
      // when this build can't ask. Older phones: the file permission, or
      // Settings once it is already on.
      onChangePapers={() =>
        !allFilesAccessApplies()
          ? docs.access === 'all'
            ? photos.openSettings()
            : docs.allowAll()
          : docs.canAskAll || docs.access === 'all'
            ? docs.allowAll()
            : docs.chooseFolder()
      }
      onOpenHelpers={() => setHelpersOpen(true)}
      sheet={<ModelDownloadSheet visible={helpersOpen} onClose={() => setHelpersOpen(false)} />}
    />
  );
};
