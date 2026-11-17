import { Linking, NativeModules } from 'react-native';

/**
 * Opens a PDF in the phone's PDF app. StorageModule.openPDF hands the file
 * over through a FileProvider; without the module the path goes to Android
 * as a link. Rejects when nothing can open it, so each caller says so in its
 * own way (a toast, a log line).
 */
export const openPdf = async (filePath: string): Promise<void> => {
  const { StorageModule } = NativeModules;
  if (StorageModule?.openPDF) {
    StorageModule.openPDF(filePath.replace('file://', ''));
    return;
  }
  await Linking.openURL(/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath) ? filePath : `file://${filePath}`);
};
