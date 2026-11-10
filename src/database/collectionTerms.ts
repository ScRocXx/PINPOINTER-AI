/**
 * The search terms that find a Home collection's files: its concept tokens
 * (`qcaadhaar`...) and exact text phrases, any of them. Shared by search
 * (a query that names a collection) and Home's tile counts, so a tile and
 * the search it opens agree.
 */
import { CONCEPT_PREFIX } from '../utils/ConceptTable';
import type { Collection } from '../utils/Collections';

export interface CollectionTerms {
  /** One FTS5 MATCH expression: every term OR-ed. */
  fts: string;
  /** `%needle%` values for `content LIKE ?`, one per term (no FTS). */
  like: string[];
}

/** Terms for `collection`, or null when it has none (Screenshots). */
export const collectionTerms = (collection: Collection | null | undefined): CollectionTerms | null => {
  if (!collection) return null;
  const terms = [
    ...collection.concepts.map(c => CONCEPT_PREFIX + c),
    ...collection.textPhrases.map(p => p.toLowerCase().replace(/"/g, '')),
  ].filter(Boolean);
  if (terms.length === 0) return null;
  return {
    fts: terms.map(t => `"${t}"`).join(' OR '),
    like: terms.map(t => `%${t}%`),
  };
};
