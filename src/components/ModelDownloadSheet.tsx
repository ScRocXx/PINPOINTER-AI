import React, { useEffect, useState } from 'react';
import { useModelService } from '../services/ModelService';
import { areClipModelsAvailable } from '../services/EmbeddingService';
import { ModelSheetView } from './ModelSheetView';

export { ModelSheetView } from './ModelSheetView';
export type { HelperState, ModelSheetViewProps } from './ModelSheetView';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Voice and photo search, in plain words: whether each on-phone helper
 * works right now, and the one fix when it doesn't. Whisper (voice) ships
 * inside the app and only needs loading; the CLIP models ("search by what's
 * in a photo") are in some builds only, and word search works without them.
 * Opened from Settings.
 *
 * @param visible Whether the sheet is shown.
 * @param onClose Called when the sheet is dismissed.
 */
export const ModelDownloadSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { isSTTLoading, isSTTLoaded, downloadAndLoadSTT } = useModelService();
  const [clip, setClip] = useState<boolean | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let alive = true;
    areClipModelsAvailable()
      .then(ok => {
        if (alive) setClip(ok);
      })
      .catch(() => {
        if (alive) setClip(false);
      });
    return () => {
      alive = false;
    };
  }, [visible]);

  return (
    <ModelSheetView
      visible={visible}
      voice={isSTTLoaded ? 'ready' : isSTTLoading ? 'loading' : 'off'}
      photo={clip === null ? 'checking' : clip ? 'ready' : 'missing'}
      onPrepare={downloadAndLoadSTT}
      onClose={onClose}
    />
  );
};
