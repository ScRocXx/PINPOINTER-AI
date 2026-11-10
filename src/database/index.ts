/**
 * Public barrel for the database layer.
 *
 * Every name exported here matches the original `src/Database.ts` public
 * API exactly — refactors must not add, rename, or drop an entry here
 * without updating the compatibility check in `__tests__/index.test.ts`.
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
} from './documents';
export { indexEmbedding, hasEmbedding, getEmbeddingCount, getImagesMissingEmbeddings } from './vectors';
export type { MissingEmbedding } from './vectors';
export {
  noteFileSeen,
  getFileState,
  markOcrDone,
  markEmbedDone,
  markEmbedSkipped,
  markStageFailed,
  getIndexingStats,
} from './fileState';
export type { FileKind, FileState, IndexingStats, PendingWork, Stage, StageStatus } from './fileState';
export { beginTransaction, commitTransaction, rollbackTransaction } from './transactions';
export { searchDocuments, extractSnippet } from './search';
