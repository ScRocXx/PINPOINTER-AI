/**
 * The words in the person's own index, for correcting typos against what is
 * actually in their papers (utils/SpellingRescue.ts).
 *
 * SQLite's fts5vocab lists every term of the search index with the number of
 * rows it is in. It is created as a TEMP table on the read connection: no
 * schema change, nothing stored, and the scan runs on op-sqlite's thread.
 */
import { AppLogger } from '../utils/AppLogger';
import { getReadDb, isFtsAvailable } from './connection';

export interface VocabularyRow {
  term: string;
  /** How many indexed papers and photos contain it. */
  docs: number;
}

let created = false;

/** @internal Test helper. */
export const __resetVocabularyTable = () => {
  created = false;
};

/** The most common terms of the search index (words and `q…` key tokens), most common first. */
export const loadVocabulary = async (limit: number): Promise<VocabularyRow[]> => {
  if (!isFtsAvailable()) return [];
  try {
    const db = getReadDb();
    if (!created) {
      await db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp.fts_vocab USING fts5vocab(main, 'fts_index', 'row')");
      created = true;
    }
    const result = await db.execute('SELECT term, doc FROM temp.fts_vocab ORDER BY doc DESC LIMIT ?', [limit]);
    return ((result?.rows ?? []) as unknown as Array<{ term: string; doc: number }>)
      .filter(r => typeof r.term === 'string')
      .map(r => ({ term: r.term, docs: Number(r.doc) || 0 }));
  } catch (e) {
    AppLogger.warn('DB', 'Could not read the index vocabulary', e);
    created = false;
    return [];
  }
};

/** The stored text of one indexed row that contains `token`, or null. */
export const textWithToken = async (token: string): Promise<string | null> => {
  if (!isFtsAvailable()) return null;
  try {
    const result = await getReadDb().execute('SELECT content FROM fts_index WHERE fts_index MATCH ? LIMIT 1', [
      `"${token.replace(/"/g, '')}"`,
    ]);
    const content = (result?.rows?.[0] as { content?: string } | undefined)?.content;
    return typeof content === 'string' ? content : null;
  } catch (e) {
    AppLogger.warn('DB', 'textWithToken failed', e);
    return null;
  }
};
