/**
 * MissingFiles — takes photos and PDFs that were deleted from the phone out
 * of the index, so search stops showing blank thumbnails and dead PDFs, and
 * a deleted photo of an ID card stops being searchable.
 *
 * A file only counts as gone when we are allowed to look and Android says it
 * doesn't exist. With limited photo access, or without All Files Access, a
 * photo or PDF we can't see may still be there, so it is left alone.
 */
import RNFS from 'react-native-fs';
import { listIndexedFiles, removeDocument, type FileKind } from '../database';
import { getPhotoAccess, hasDocumentAccess } from './StoragePermissions';
import { IMPORTED_PDF_DIR } from './PdfImport';
import { AppLogger } from './AppLogger';

const PAGE_SIZE = 200;

interface Access {
    photos: boolean;
    docs: boolean;
}

const currentAccess = async (): Promise<Access> => ({
    photos: (await getPhotoAccess()) === 'full',
    docs: await hasDocumentAccess(),
});

/** True only when we may look and the file really is gone. */
const isGone = async (uri: string, kind: FileKind, access: Access): Promise<boolean> => {
    const ownCopy = uri.startsWith(`file://${IMPORTED_PDF_DIR}/`); // in app storage, always readable
    if (kind === 'IMAGE' ? !access.photos : !(ownCopy || access.docs)) return false;
    try {
        // stat understands both file paths and the content:// URIs gallery photos use.
        await RNFS.stat(uri);
        return false;
    } catch (e) {
        // Any other error (no permission, provider busy) keeps the row.
        return /does not exist|ENOENT/i.test(e instanceof Error ? e.message : String(e));
    }
};

/** Takes `uri` out of the index if the file was deleted. Resolves true when it was. */
export const forgetIfGone = async (uri: string, kind: FileKind): Promise<boolean> => {
    if (!(await isGone(uri, kind, await currentAccess()))) return false;
    removeDocument(uri);
    return true;
};

/**
 * Checks every indexed file and removes the deleted ones. Run it through
 * IndexingService (background job). Resolves with how many were removed.
 */
export const pruneMissingFiles = async (cancelRef?: { current: boolean }): Promise<number> => {
    const access = await currentAccess();
    let removed = 0;
    let afterId = 0;
    while (!cancelRef?.current) {
        const page = listIndexedFiles(afterId, PAGE_SIZE);
        if (page.length === 0) break;
        for (const row of page) {
            if (cancelRef?.current) break;
            afterId = row.id;
            const kind: FileKind = row.type === 'DOCUMENT' ? 'DOCUMENT' : 'IMAGE';
            if (await isGone(row.filePath, kind, access)) {
                removeDocument(row.filePath);
                removed++;
            }
        }
    }
    if (removed > 0) AppLogger.info('MissingFiles', `Removed ${removed} deleted files from the index.`);
    return removed;
};
