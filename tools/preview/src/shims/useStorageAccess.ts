// Photo and PDF access for the browser preview: photos allowed, PDFs by folder.
const full = async () => 'full' as const;
export const usePhotoAccess = () => ({ access: 'full' as const, refresh: full, request: full, openSettings: full });
export const useDocumentAccess = () => ({
  access: 'folders' as const,
  canAskAll: true,
  refresh: async () => 'folders' as const,
  allowAll: async () => 'folders' as const,
  chooseFolder: async () => true,
  pickFiles: async () => 2,
});
