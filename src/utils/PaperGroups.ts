/**
 * PaperGroups: the six kinds of papers the Papers tab shows, built on the
 * classifier's 20 categories. People look for "my ID", "a bill", "the bank
 * paper", not for "Driving License" vs "Voter ID", so the tiles stay few.
 */
import type { DocumentRecord } from '../database';
import type { StringKey } from '../i18n';
import type { IconName } from '../components/ui/iconPaths';
import { Tints, TintName } from '../theme';
import { classifyDocument, type DocumentCategory } from './DocumentClassifier';

export type PaperGroup = 'id' | 'bills' | 'bank' | 'medical' | 'tax' | 'other';

/** Tile order on the Papers tab. */
export const PAPER_GROUPS: ReadonlyArray<PaperGroup> = ['id', 'bills', 'bank', 'medical', 'tax', 'other'];

const GROUP_OF: Partial<Record<DocumentCategory, PaperGroup>> = {
  AADHAAR_CARD: 'id',
  PAN_CARD: 'id',
  VOTER_ID: 'id',
  DRIVING_LICENSE: 'id',
  PASSPORT: 'id',
  INVOICE: 'bills',
  RECEIPT: 'bills',
  ELECTRICITY_BILL: 'bills',
  PHONE_BILL: 'bills',
  BANK_STATEMENT: 'bank',
  SALARY_SLIP: 'bank',
  MEDICAL_REPORT: 'medical',
  TAX_RETURN: 'tax',
};

export const groupOfCategory = (category: DocumentCategory): PaperGroup => GROUP_OF[category] ?? 'other';

export interface PaperGroupLook {
  /** Tile name ("ID cards"). */
  label: StringKey;
  /** Short tag on a row ("ID"). */
  kind: StringKey;
  icon: IconName;
  tint: TintName;
}

export const PAPER_GROUP_LOOK: Record<PaperGroup, PaperGroupLook> = {
  id: { label: 'papers.cat.id', kind: 'papers.kind.id', icon: 'idCard', tint: 'id' },
  bills: { label: 'papers.cat.bills', kind: 'papers.kind.bill', icon: 'bill', tint: 'bill' },
  bank: { label: 'papers.cat.bank', kind: 'papers.kind.bank', icon: 'bank', tint: 'bank' },
  medical: { label: 'papers.cat.medical', kind: 'papers.kind.medical', icon: 'medicine', tint: 'medicine' },
  tax: { label: 'papers.cat.tax', kind: 'papers.kind.tax', icon: 'papers', tint: 'other' },
  other: { label: 'papers.cat.other', kind: 'papers.kind.other', icon: 'folder', tint: 'other' },
};

export const tintOf = (group: PaperGroup) => Tints[PAPER_GROUP_LOOK[group].tint];

/** The file name at the end of a path or uri. */
export const fileNameOf = (filePath: string): string => {
  const name = filePath.split('/').pop() ?? '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};

/** A paper with its group, as the Papers tab lists it. */
export interface Paper {
  doc: DocumentRecord;
  group: PaperGroup;
  /** The stored (masked) title, else the file name without ".pdf". */
  title: string;
}

/** Names a paper and puts it in a group. Titles were masked at index time. */
export const toPaper = (doc: DocumentRecord): Paper => {
  const fileName = fileNameOf(doc.filePath);
  const group = groupOfCategory(classifyDocument(doc.content || '', fileName).category);
  const title = doc.title?.trim() || fileName.replace(/\.pdf$/i, '').trim();
  return { doc, group, title };
};

/** How many papers are in each group. */
export const countByGroup = (papers: ReadonlyArray<Paper>): Record<PaperGroup, number> => {
  const counts: Record<PaperGroup, number> = { id: 0, bills: 0, bank: 0, medical: 0, tax: 0, other: 0 };
  for (const p of papers) {
    counts[p.group] += 1;
  }
  return counts;
};

/** Plain substring match on the title, file name and text, any case. */
export const matchesQuery = (paper: Paper, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return [paper.title, fileNameOf(paper.doc.filePath), paper.doc.content ?? ''].some(s => s.toLowerCase().includes(q));
};
