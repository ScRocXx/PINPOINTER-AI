// Folder and PDF pickers for the browser preview: two chosen folders.
export type PdfFolder = { uri: string; name: string };
let folders: PdfFolder[] = [
  { uri: 'content://tree/bills', name: 'Bills 2026' },
  { uri: 'content://tree/school', name: 'School papers' },
];
export const isPdfImportAvailable = () => true;
export const canRequestAllFilesAccess = async () => true;
export const listPdfFolders = async () => folders;
export const pickPdfFolder = async (): Promise<PdfFolder | null> => {
  const folder = { uri: `content://tree/${folders.length}`, name: 'Medical' };
  folders = [...folders, folder];
  return folder;
};
export const pickPdfFiles = async () => 2;
export const forgetPdfFolder = async (uri: string) => {
  folders = folders.filter(f => f.uri !== uri);
};
