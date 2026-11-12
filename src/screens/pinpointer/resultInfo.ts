import { DocumentRecord } from '../../database';
import { StringKey } from '../../i18n';
import { IconName } from '../../components/ui';
import { TintName } from '../../theme';
import { DocumentCategory, classifyDocument } from '../../utils/DocumentClassifier';
import { maskSensitiveData } from '../../utils/DataMasking';
import { matchTermsIn, snippetFrom } from '../../utils/MatchTerms';

/** The kind of paper, for the row's tile and its word ("Bill", "ID"). */
export interface PaperKind {
  icon: IconName;
  tint: TintName;
  /** Empty for a plain paper (the row already says "Paper"). */
  label: StringKey | null;
}

const ID: DocumentCategory[] = ['AADHAAR_CARD', 'PAN_CARD', 'VOTER_ID', 'DRIVING_LICENSE', 'PASSPORT'];
const BILL: DocumentCategory[] = ['INVOICE', 'RECEIPT', 'ELECTRICITY_BILL', 'PHONE_BILL'];
const BANK: DocumentCategory[] = ['BANK_STATEMENT', 'SALARY_SLIP'];
const MEDICAL: DocumentCategory[] = ['MEDICAL_REPORT'];
const TAX: DocumentCategory[] = ['TAX_RETURN'];

export const paperKind = (category: DocumentCategory): PaperKind => {
  if (ID.includes(category)) return { icon: 'idCard', tint: 'id', label: 'papers.kind.id' };
  if (BILL.includes(category)) return { icon: 'bill', tint: 'bill', label: 'papers.kind.bill' };
  if (BANK.includes(category)) return { icon: 'bank', tint: 'bank', label: 'papers.kind.bank' };
  if (MEDICAL.includes(category)) return { icon: 'medicine', tint: 'medicine', label: 'papers.kind.medical' };
  if (TAX.includes(category)) return { icon: 'bill', tint: 'bill', label: 'papers.kind.tax' };
  return { icon: 'papers', tint: 'other', label: null };
};

/** A readable name from a path. A stray "%" ("50% off.pdf") is kept as it is. */
export const fileNameOf = (path: string): string => {
  let name = path.split('/').pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not URI-encoded: use the name as it is.
  }
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
};

/** Everything a result row shows, worked out once per result and query. */
export interface ResultInfo {
  isPhoto: boolean;
  /** Papers: the stored (masked) title or the file name. Photos: none. */
  title: string | null;
  /** The text to show, starting at the first matched word when there is one. */
  snippet: string;
  /** Words to mark in the title and snippet. */
  terms: string[];
  /** The words in the text match (vs. a photo that only looks similar). */
  wordsMatch: boolean;
  /** The photo's text is what ML Kit saw in it ("Dog, Grass"), not words in it. */
  isLabels: boolean;
  kind: PaperKind | null;
}

export const describeResult = (item: DocumentRecord, query: string): ResultInfo => {
  const isPhoto = item.type === 'IMAGE';
  const content = item.content ?? '';
  if (isPhoto) {
    const isLabels = item.detection_type === 'OBJECT';
    const terms = matchTermsIn(content, query);
    const snippet = isLabels ? content.replace(/\s+/g, ' ').trim() : snippetFrom(content, terms);
    return { isPhoto, title: null, snippet, terms, wordsMatch: terms.length > 0, isLabels, kind: null };
  }
  // Stored titles are masked at index time; a file name never went through that.
  const title = (item.title ?? '').trim() || maskSensitiveData(fileNameOf(item.filePath));
  const terms = matchTermsIn(`${title} ${content}`, query);
  const snippet = snippetFrom(content, terms);
  const kind = paperKind(classifyDocument(content, item.filePath.split('/').pop() || '').category);
  return { isPhoto, title, snippet, terms, wordsMatch: terms.length > 0, isLabels: false, kind };
};
