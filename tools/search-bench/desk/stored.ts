/**
 * What the app stores for each test file, shared by the desk bench and the
 * inspector so both index exactly the same text.
 */
export interface CorpusDoc {
  id: string;
  kind: 'IMAGE' | 'DOCUMENT';
  detection: 'TEXT' | 'OBJECT' | 'EMPTY';
  ocr: string | null;
  lines: string[] | null;
  pagesOcr: string[] | null;
  pdfKind: 'digital' | 'scanned' | 'password' | null;
  labels: string[] | null;
  takenAt: number;
  copyOf: string | null;
  folder: string;
  fileName: string;
}

/** Where a test file "lives" (its real file name); results are turned back into ids by the name's start. */
export const benchPath = (doc: Pick<CorpusDoc, 'folder' | 'fileName'>) => `/storage/emulated/0/${doc.folder}/PinpointerBench/${doc.fileName}`;

/** The bench id at the start of a stored path's file name. */
export const idOfPath = (p: string) => p.split('/').pop()?.match(/^d\d{5}/)?.[0] ?? p;

/**
 * What the app stores for a photo or PDF, as GallerySync and DocumentPipeline
 * do. PDFs: the native text step reads only old uncompressed PDFs (see
 * pdf.bench.ts), so compressed ones (nearly all) go to OCR: the first 500
 * characters of pages 1-3, at most 2000, after the file name without ".pdf".
 * A locked PDF can't be drawn either: only its name is stored.
 */
export const storedText = (d: CorpusDoc): string => {
  if (d.kind === 'DOCUMENT') {
    const name = d.fileName.replace(/\.pdf$/i, '');
    if (d.pdfKind === 'password') return `${name} Document Document: ${d.fileName}`;
    const pages = (d.pagesOcr ?? [d.ocr ?? '']).slice(0, 3).map(p => p.substring(0, 500));
    return `${name} ${pages.join(' ')}`.substring(0, 2000);
  }
  if (d.detection === 'TEXT') return (d.ocr ?? '').trim() || 'image';
  if (d.detection === 'OBJECT') return (d.labels ?? []).join(' ');
  return 'image';
};

/** PDF sync looks in Download, Documents and imported copies only (DocumentSync.scanForPDFs). */
export const appCanSee = (d: CorpusDoc) => d.folder !== 'WhatsApp';
