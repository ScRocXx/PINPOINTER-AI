import { Linking, NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { DocumentRecord } from '../../database';
import { AppLogger } from '../../utils/AppLogger';
import { forgetIfGone } from '../../utils/MissingFiles';

const { StorageModule } = NativeModules;

export type OpenOutcome = 'open' | 'gone' | 'failed';

/**
 * Check a tapped result before opening it. A file deleted from the phone is
 * taken out of search right away ('gone'). Papers open in the phone's PDF
 * app here; for photos the caller opens the viewer when this says 'open'.
 */
export const openResult = async (item: DocumentRecord): Promise<OpenOutcome> => {
  try {
    if (await forgetIfGone(item.filePath, item.type)) return 'gone';
    if (item.type !== 'DOCUMENT') return 'open';

    const cleanPath = item.filePath.replace('file://', '');
    const exists = await RNFS.exists(cleanPath).catch(() => false);
    if (!exists) return 'gone';
    if (StorageModule?.openPDF) {
      StorageModule.openPDF(cleanPath);
    } else {
      await Linking.openURL(item.filePath);
    }
    return 'open';
  } catch (e) {
    AppLogger.error('Search', 'Could not open a result', e);
    return 'failed';
  }
};
