// The database for the browser preview: a few sample papers, no SQLite.
import { SAMPLE_PAPERS, SAMPLE_SCAN_TEXT } from './sample';

export type DocumentRecord = (typeof SAMPLE_PAPERS)[number];

export const getAllDocuments = () => SAMPLE_PAPERS;
export const searchDocuments = (query: string) => {
  const q = query.trim().toLowerCase();
  return SAMPLE_PAPERS.filter(p => `${p.title} ${p.content}`.toLowerCase().includes(q));
};
export const getDocumentByPath = (filePath: string) =>
  filePath.startsWith('data:') ? { ...SAMPLE_PAPERS[0], filePath, type: 'IMAGE', content: SAMPLE_SCAN_TEXT.replace(/\n/g, ' ') } : null;
