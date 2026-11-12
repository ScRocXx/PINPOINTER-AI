// Permissions for the browser preview: photos allowed, All files access off
// (so the folders screen shows its "Allow" card).
export type PhotoAccess = 'full' | 'limited' | 'denied' | 'blocked';
export const getPhotoAccess = async (): Promise<PhotoAccess> => 'full';
export const ensurePhotoAccess = async () => true;
export const openAppSettingsAndWait = async (): Promise<PhotoAccess> => 'full';
export const hasDocumentAccess = async () => false;
export const openAllFilesAccessAndWait = async () => false;
export const photoSettingsWording = (): { list: 'photos' | 'files'; choice: 'allowAll' | 'allow' } => ({
  list: 'photos',
  choice: 'allowAll',
});
export const allFilesAccessApplies = () => true;
export const ensureDocumentAccess = async () => false;
