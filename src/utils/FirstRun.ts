/**
 * FirstRun: remembers whether the welcome and permission steps are done.
 *
 * People updating from a version without these steps already have photos
 * ready to find, so they are not greeted as new: an existing index counts
 * as "done" (and is remembered).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getIndexedCount } from '../database';
import { AppLogger } from './AppLogger';

export const FIRST_RUN_KEY = 'pinpointer.firstRunDone';

/** Remember that the first run is finished, so it never shows again. */
export const markFirstRunDone = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(FIRST_RUN_KEY, '1');
  } catch (e) {
    AppLogger.warn('FirstRun', 'Could not save that the first run is done', e);
  }
};

/** True when the welcome steps should be skipped. Never throws. */
export const hasFinishedFirstRun = async (): Promise<boolean> => {
  try {
    if ((await AsyncStorage.getItem(FIRST_RUN_KEY)) === '1') {
      return true;
    }
  } catch (e) {
    AppLogger.warn('FirstRun', 'Could not read the first-run flag', e);
  }
  if (getIndexedCount() > 0) {
    await markFirstRunDone();
    return true;
  }
  return false;
};
