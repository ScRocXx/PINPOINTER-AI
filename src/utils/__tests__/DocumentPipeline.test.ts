/**
 * DocumentPipeline.test.ts — unit tests for the 5-phase PDF intelligence pipeline.
 *
 * Covers src/utils/DocumentPipeline.ts:
 *   Phase 1: Metadata Extraction  (NativePdfModule.getPdfInfo)
 *   Phase 2: Native Text Check    (RNFS.read + BT/ET heuristic, early exit for digital PDFs)
 *   Phase 3: Page Rasterization   (NativePdfModule.rasterizePages)
 *   Phase 4: AI Intelligence      (analyzeImage from VisionPipeline — mocked here)
 *   Phase 5: Search Indexing      (classify → mask → soundex → indexDocument)
 *
 * Strategy:
 *   - NativePdfModule is stubbed in jest.setup.js; per-test behavior via mockResolvedValue.
 *   - VisionPipeline.analyzeImage is module-mocked for isolation (OCR is VisionPipeline's job).
 *   - react-native-fs is auto-mocked from __mocks__/; RNFS.read (used by the native-text
 *     heuristic) is attached at runtime since the mock file doesn't define it.
 *   - indexDocument is spied on (not stubbed) so we assert exactly what the pipeline
 *     tries to index, while the in-memory op-sqlite mock records real DB rows for
 *     end-to-end masking assertions via getAllDocuments().
 */

jest.mock('../VisionPipeline', () => ({ analyzeImage: jest.fn() }));

import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { analyzeImage } from '../VisionPipeline';
import { soundex } from '../Soundex';
import { processPDF } from '../DocumentPipeline';
import * as DatabaseDocuments from '../../database/documents';
import { getAllDocuments, clearIndex } from '../../database';

const { NativePdfModule } = NativeModules;
const pdfModule = NativePdfModule as unknown as {
    getPdfInfo: jest.Mock;
    rasterizePages: jest.Mock;
    cleanupCache: jest.Mock;
};

// The react-native-fs mock has no `read` method, which extractNativeText() uses.
// Attach a stub at runtime — this does not modify the mock file itself.
const RNFSStub = RNFS as unknown as Record<string, jest.Mock>;
if (!RNFSStub.read) {
    RNFSStub.read = jest.fn();
}
const rnfsRead: jest.Mock = RNFSStub.read;
const rnfsStat = RNFS.stat as unknown as jest.Mock;

// Spy (not stub) on the DB chokepoint: capture index args, keep real writes.
const indexSpy = jest.spyOn(DatabaseDocuments, 'indexDocument');

const PDF_PATH = '/docs/test-doc.pdf';
const FILE_URI = 'file:///docs/test-doc.pdf';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ocrResult = (
    content: string,
    detection_type: 'TEXT' | 'OBJECT' | 'EMPTY' = 'TEXT',
) => ({
    detection_type,
    raw_text: content,
    content,
    search_index: [content],
    optimized_status: 'OCR_RAN',
    embedding: null,
});

/** Minimal fake PDF bytes with embedded text in a BT…ET block using the Tj operator. */
const digitalPdfBytes = (text: string): string =>
    `%PDF-1.4\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\n%%EOF`;

const INVOICE_TEXT =
    'Tax Invoice Number INV-1001 Bill To Acme Corp Subtotal 5000 Total 5900';

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeAll(() => {
    // AppLogger + Database write to console on every pipeline run — silence it.
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    jest.restoreAllMocks();
});

beforeEach(() => {
    jest.clearAllMocks();
    clearIndex();

    rnfsStat.mockResolvedValue({
        size: 100 * 1024,
        mtime: 0,
        ctime: 0,
        isFile: () => true,
        isDirectory: () => false,
    });
    // Default: scanned PDF — no extractable native text.
    rnfsRead.mockResolvedValue('');

    pdfModule.getPdfInfo.mockResolvedValue({
        fileName: 'test-doc.pdf',
        pageCount: 5,
        fileSize: 2048,
    });
    pdfModule.rasterizePages.mockResolvedValue(['/tmp/p1.jpg', '/tmp/p2.jpg', '/tmp/p3.jpg']);
    pdfModule.cleanupCache.mockResolvedValue(undefined);

    (analyzeImage as jest.Mock).mockResolvedValue(ocrResult('Sample OCR text from page'));
});

// ─── Phase 1+2: Digital PDF — early exit ─────────────────────────────────────

describe('Digital PDF — early exit at Phase 2', () => {
    test('returns TEXT_INDEXED with TEXT detection and zero pages processed', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes(INVOICE_TEXT));

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('TEXT_INDEXED');
        expect(result.detectionType).toBe('TEXT');
        expect(result.pagesProcessed).toBe(0);
        expect(result.content).toContain('Tax Invoice Number INV-1001');
    });

    test('skips rasterization, OCR and cache cleanup entirely on the early-exit path', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes(INVOICE_TEXT));

        await processPDF(PDF_PATH);

        expect(pdfModule.rasterizePages).not.toHaveBeenCalled();
        expect(analyzeImage).not.toHaveBeenCalled();
        expect(pdfModule.cleanupCache).not.toHaveBeenCalled();
    });

    test('requests metadata with the normalized file:// URI and passes it through', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes(INVOICE_TEXT));

        const result = await processPDF(PDF_PATH);

        expect(pdfModule.getPdfInfo).toHaveBeenCalledWith(FILE_URI);
        expect(result.metadata).toEqual({
            fileName: 'test-doc.pdf',
            pageCount: 5,
            fileSize: 2048,
        });
    });

    test('does not double the file:// prefix when the input already has one', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes(INVOICE_TEXT));

        await processPDF('file:///docs/already.pdf');

        expect(pdfModule.getPdfInfo).toHaveBeenCalledWith('file:///docs/already.pdf');
    });

    test('indexes the document as DOCUMENT/TEXT and classifies an invoice on early exit', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes(INVOICE_TEXT));

        const result = await processPDF(PDF_PATH);

        expect(indexSpy).toHaveBeenCalledTimes(1);
        const [title, indexedContent, filePath, type, detection] = indexSpy.mock.calls[0];
        expect(typeof title).toBe('string');
        expect((title as string).length).toBeGreaterThan(0);
        expect(filePath).toBe(FILE_URI);
        expect(type).toBe('DOCUMENT');
        expect(detection).toBe('TEXT');
        expect(String(indexedContent)).toContain('Invoice'); // category label baked in

        expect(result.classification.category).toBe('INVOICE');
        expect(result.classification.label).toBe('Invoice');
        expect(result.smartTitle.length).toBeGreaterThan(0);
    });

    test('applies soundex enrichment even on the early-exit path', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes(INVOICE_TEXT));

        await processPDF(PDF_PATH);

        const indexedContent = String(indexSpy.mock.calls[0][1]);
        expect(indexedContent).toContain(soundex('invoice'));
        expect(indexedContent).toContain(soundex('total'));
    });

    test('truncates native text to the 2000-char total cap', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes('A'.repeat(3000)));

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('TEXT_INDEXED');
        expect(result.content.length).toBe(2000);
    });

    test('extracts text from TJ array operators, not just Tj', async () => {
        rnfsRead.mockResolvedValue(
            '%PDF-1.4\nBT [(Hello World from TJ) -10 (array operator test)] TJ ET\n%%EOF',
        );

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('TEXT_INDEXED');
        expect(result.content).toContain('Hello World from TJ array operator test');
    });

    test('indexing failure yields a fallback classification instead of throwing', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes(INVOICE_TEXT));
        indexSpy.mockImplementationOnce(() => {
            throw new Error('db down');
        });

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('TEXT_INDEXED');
        expect(result.classification).toEqual({
            category: 'GENERAL_DOCUMENT',
            emoji: '📄',
            label: 'Document',
            confidence: 0,
        });
        expect(result.smartTitle).toBe('test-doc');
    });
});

// ─── Phase 5: PII masking before indexing ────────────────────────────────────

describe('PII masking is applied before indexing', () => {
    test('masks Aadhaar numbers found in digital PDF text', async () => {
        rnfsRead.mockResolvedValue(
            digitalPdfBytes('Aadhaar Card Holder 2345 6789 0123 Name Ramesh Kumar'),
        );

        await processPDF('/docs/aadhaar-test.pdf');

        const indexedContent = String(indexSpy.mock.calls[0][1]);
        expect(indexedContent).not.toContain('2345 6789 0123');
        expect(indexedContent).toContain('****-****-0123');
    });

    test('masks PAN numbers found in OCR content', async () => {
        (analyzeImage as jest.Mock).mockResolvedValue(
            ocrResult('Permanent Account Number ABCDE1234F issued to Sharma'),
        );

        await processPDF(PDF_PATH);

        const indexedContent = String(indexSpy.mock.calls[0][1]);
        expect(indexedContent).not.toContain('ABCDE1234F');
        expect(indexedContent).toContain('ABCDE****F');
    });

    test('masks Indian phone numbers found in OCR content', async () => {
        (analyzeImage as jest.Mock).mockResolvedValue(
            ocrResult('Customer care call 9876543210 for support today'),
        );

        await processPDF(PDF_PATH);

        const indexedContent = String(indexSpy.mock.calls[0][1]);
        expect(indexedContent).not.toContain('9876543210');
        expect(indexedContent).toContain('******3210');
    });

    test('the row actually stored in the DB contains no raw Aadhaar digits', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes('Aadhaar verification 2345 6789 0123 done'));

        await processPDF('/docs/aadhaar-db.pdf');

        const docs = getAllDocuments();
        expect(docs).toHaveLength(1);
        expect(docs[0].filePath).toBe('file:///docs/aadhaar-db.pdf');
        expect(docs[0].content).not.toContain('2345 6789 0123');
        expect(docs[0].content).toContain('****-****-0123');
    });
});

// ─── Phases 3+4: Scanned PDF — rasterize + OCR ───────────────────────────────

describe('Scanned PDF — rasterize + OCR path', () => {
    test('rasterizes min(3, pageCount) pages with the normalized URI', async () => {
        await processPDF(PDF_PATH);

        expect(pdfModule.rasterizePages).toHaveBeenCalledWith(FILE_URI, 3);
    });

    test('runs analyzeImage once per rasterized page with a file:// URI', async () => {
        await processPDF(PDF_PATH);

        expect(analyzeImage).toHaveBeenCalledTimes(3);
        expect(analyzeImage).toHaveBeenNthCalledWith(1, 'file:///tmp/p1.jpg');
        expect(analyzeImage).toHaveBeenNthCalledWith(2, 'file:///tmp/p2.jpg');
        expect(analyzeImage).toHaveBeenNthCalledWith(3, 'file:///tmp/p3.jpg');
    });

    test('combines per-page OCR content and reports OCR_COMPLETE', async () => {
        (analyzeImage as jest.Mock).mockImplementation((uri: string) =>
            Promise.resolve(ocrResult(`text-from-${uri.split('/').pop()}`)),
        );

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('OCR_COMPLETE');
        expect(result.detectionType).toBe('TEXT');
        expect(result.pagesProcessed).toBe(3);
        expect(result.content).toContain('text-from-p1.jpg');
        expect(result.content).toContain('text-from-p2.jpg');
        expect(result.content).toContain('text-from-p3.jpg');
    });

    test('passes OBJECT detection through to the result and the index', async () => {
        (analyzeImage as jest.Mock).mockResolvedValue(ocrResult('cat dog vehicle', 'OBJECT'));

        const result = await processPDF(PDF_PATH);

        expect(result.detectionType).toBe('OBJECT');
        expect(indexSpy.mock.calls[0][4]).toBe('OBJECT');
    });

    test('uses the fallback title and TEXT index type when every page is EMPTY', async () => {
        (analyzeImage as jest.Mock).mockResolvedValue(ocrResult('', 'EMPTY'));

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('OCR_COMPLETE');
        expect(result.detectionType).toBe('EMPTY');
        expect(result.pagesProcessed).toBe(3);
        expect(result.content).toBe('Document: test-doc.pdf');
        // EMPTY OCR still indexes as TEXT so the file stays discoverable
        expect(indexSpy.mock.calls[0][4]).toBe('TEXT');
    });

    test('classifies OCR content (invoice keywords → INVOICE)', async () => {
        (analyzeImage as jest.Mock).mockResolvedValue(ocrResult(INVOICE_TEXT));

        const result = await processPDF(PDF_PATH);

        expect(result.classification.category).toBe('INVOICE');
        expect(result.smartTitle.length).toBeGreaterThan(0);
    });

    test('calls cleanupCache after the OCR loop finishes', async () => {
        await processPDF(PDF_PATH);

        expect(pdfModule.cleanupCache).toHaveBeenCalledTimes(1);
    });
});

// ─── Page caps ───────────────────────────────────────────────────────────────

describe('Page caps', () => {
    test('truncates each page to 500 chars', async () => {
        (analyzeImage as jest.Mock).mockResolvedValue(ocrResult('x'.repeat(1200)));

        const result = await processPDF(PDF_PATH);

        const parts = result.content.split(' ');
        expect(parts).toHaveLength(3);
        for (const part of parts) {
            expect(part.length).toBe(500);
        }
    });

    test('truncates combined content to the 2000-char total cap', async () => {
        // Native layer over-delivers pages; the pipeline must still cap the total.
        pdfModule.rasterizePages.mockResolvedValue([
            '/tmp/p1.jpg',
            '/tmp/p2.jpg',
            '/tmp/p3.jpg',
            '/tmp/p4.jpg',
            '/tmp/p5.jpg',
            '/tmp/p6.jpg',
        ]);
        (analyzeImage as jest.Mock).mockResolvedValue(ocrResult('y'.repeat(600)));

        const result = await processPDF(PDF_PATH);

        expect(result.pagesProcessed).toBe(6);
        expect(result.content.length).toBe(2000);
    });

    test('caps a huge pageCount at 3 foreground pages', async () => {
        pdfModule.getPdfInfo.mockResolvedValue({
            fileName: 'huge.pdf',
            pageCount: 50,
            fileSize: 99999,
        });

        await processPDF('/docs/huge.pdf');

        expect(pdfModule.rasterizePages).toHaveBeenCalledWith('file:///docs/huge.pdf', 3);
    });

    test('a 0-page PDF still attempts the 3 foreground pages', async () => {
        pdfModule.getPdfInfo.mockResolvedValue({
            fileName: 'empty.pdf',
            pageCount: 0,
            fileSize: 128,
        });

        await processPDF('/docs/empty.pdf');

        // 0 || FOREGROUND_PAGES → 3
        expect(pdfModule.rasterizePages).toHaveBeenCalledWith('file:///docs/empty.pdf', 3);
    });
});

// ─── Error recovery ──────────────────────────────────────────────────────────

describe('Error recovery', () => {
    test('getPdfInfo rejection → fallback metadata, OCR still runs, no throw', async () => {
        pdfModule.getPdfInfo.mockRejectedValue(new Error('native crash'));

        const result = await processPDF('/docs/broken.pdf');

        expect(result.status).toBe('OCR_COMPLETE');
        expect(result.metadata).toEqual({ fileName: 'broken.pdf', pageCount: 0, fileSize: 0 });
        expect(result.pagesProcessed).toBe(3);
        expect(pdfModule.rasterizePages).toHaveBeenCalled();
    });

    test('rasterizePages rejection → graceful EMPTY result, no cleanup, no throw', async () => {
        pdfModule.getPdfInfo.mockResolvedValue({
            fileName: 'unrenderable.pdf',
            pageCount: 5,
            fileSize: 2048,
        });
        pdfModule.rasterizePages.mockRejectedValue(new Error('render failed'));

        const result = await processPDF('/docs/unrenderable.pdf');

        expect(result.status).toBe('OCR_COMPLETE');
        expect(result.detectionType).toBe('EMPTY');
        expect(result.pagesProcessed).toBe(0);
        expect(result.content).toBe('Document: unrenderable.pdf');
        expect(pdfModule.cleanupCache).not.toHaveBeenCalled();
        expect(indexSpy).toHaveBeenCalledTimes(1);
    });

    test('rasterizePages resolving to [] → EMPTY result without calling OCR', async () => {
        pdfModule.rasterizePages.mockResolvedValue([]);

        const result = await processPDF(PDF_PATH);

        expect(result.detectionType).toBe('EMPTY');
        expect(result.pagesProcessed).toBe(0);
        expect(analyzeImage).not.toHaveBeenCalled();
        expect(result.content).toBe('Document: test-doc.pdf');
    });

    test('one failing page does not poison the other pages', async () => {
        (analyzeImage as jest.Mock).mockImplementation((uri: string) => {
            if (uri.includes('p2.jpg')) {
                return Promise.reject(new Error('ocr boom'));
            }
            const tag = uri.includes('p1.jpg') ? 'one' : 'three';
            return Promise.resolve(ocrResult(`content-${tag}`));
        });

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('OCR_COMPLETE');
        expect(result.content).toContain('content-one');
        expect(result.content).toContain('content-three');
        expect(result.content).not.toContain('content-two');
        expect(pdfModule.cleanupCache).toHaveBeenCalledTimes(1);
    });

    test('native text extraction failure falls back to the OCR path', async () => {
        rnfsRead.mockRejectedValue(new Error('read failed'));

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('OCR_COMPLETE');
        expect(pdfModule.rasterizePages).toHaveBeenCalled();
    });

    test('cleanupCache failure is swallowed and the pipeline still succeeds', async () => {
        pdfModule.cleanupCache.mockRejectedValue(new Error('cache fail'));

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('OCR_COMPLETE');
        expect(result.pagesProcessed).toBe(3);
    });

    test('short native text (< 20 chars) is treated as image-based and goes to OCR', async () => {
        rnfsRead.mockResolvedValue(digitalPdfBytes('Tiny bill'));

        const result = await processPDF(PDF_PATH);

        expect(result.status).toBe('OCR_COMPLETE');
        expect(pdfModule.rasterizePages).toHaveBeenCalled();
    });

    test('totally missing file resolves with fallback metadata instead of throwing', async () => {
        rnfsStat.mockRejectedValue(new Error('ENOENT'));
        pdfModule.getPdfInfo.mockRejectedValue(new Error('ENOENT'));
        pdfModule.rasterizePages.mockRejectedValue(new Error('ENOENT'));

        const result = await processPDF('/docs/missing.pdf');

        expect(result.status).toBe('OCR_COMPLETE');
        expect(result.metadata).toEqual({ fileName: 'missing.pdf', pageCount: 0, fileSize: 0 });
        expect(result.content).toBe('Document: missing.pdf');
        expect(result.detectionType).toBe('EMPTY');
        expect(result.pagesProcessed).toBe(0);
    });
});
