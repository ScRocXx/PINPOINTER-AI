/**
 * Public barrel for the database layer: what the rest of the app may call.
 *
 * `__tests__/index.test.ts` lists these names; add, rename or drop an entry
 * there in the same change.
 */
export type { DocumentRecord } from './types';
export { closeDatabase, setupDatabase } from './connection';
export {
  isFileIndexed,
  getDocumentId,
  indexDocument,
  getIndexedCount,
  clearIndex,
  getAllDocuments,
  getDocumentByPath,
  removeDocument,
  listIndexedFiles,
  listContentAfter,
  updateDocumentContent,
  setTakenAt,
} from './documents';
export { indexEmbedding, hasEmbedding, getEmbedding, getEmbeddingCount, getImagesMissingEmbeddings } from './vectors';
export type { MissingEmbedding } from './vectors';
export {
  noteFileSeen,
  getFileState,
  markOcrDone,
  markEmbedDone,
  markStageFailed,
  getReadyCounts,
  countCheckedFiles,
  setFingerprint,
  findTwin,
  fingerprintsFor,
} from './fileState';
export type { FileKind, FileState, PendingWork, ReadyCounts, Stage, StageStatus } from './fileState';
export { beginTransaction, commitTransaction, rollbackTransaction } from './transactions';
export { searchDocuments, searchDocumentsAsync, understandQuery, listNewest } from './search';
export type { QueryMeaning } from './search';
export { getCollectionPreview, getSimilarPhotos, getSimilarPhotosAsync } from './collections';
export type { CollectionPreview } from './collections';
