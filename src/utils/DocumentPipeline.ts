/**
 * DocumentPipeline.ts — 5-Phase PDF Intelligence Pipeline
 *
 * Transforms raw PDF files into searchable, indexed content through:
 *
 *   Phase 1: Metadata Extraction  (page count, filename)            ~10ms
 *   Phase 2: Native Text Check    (skip OCR if text exists)         ~50ms
 *   Phase 3: Page Rasterization   (PDF → JPEG via native Android)   ~200ms/page
 *   Phase 4: AI Intelligence      (OCR + labeling via VisionPipeline) ~300ms/page
 *   Phase 5: Search Indexing      (enriched content → SQLite + FTS5)  ~5ms
 *
 * Key optimizations:
 *   - Early exit at Phase 2 for digital PDFs (no OCR needed)
 *   - Smart truncation: 500 chars/page, 2000 chars max per document
 *   - Pages 1-3 processed foreground, 4+ deferred for background
 *   - Soundex + transliteration applied even on early-exit path
 */

import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { analyzeImage } from './VisionPipeline';
import { soundexAll } from './Soundex';
import { classifyDocument, extractSmartTitle, type ClassificationResult } from './DocumentClassifier';
import { maskSensitiveData } from './DataMasking';
import { indexDocument } from '../database';
import { AppLogger } from './AppLogger';

const { NativePdfModule } = NativeModules;

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_CHARS_PER_PAGE = 500;
const MAX_TOTAL_CHARS = 2000;
const FOREGROUND_PAGES = 3;   // Pages 1-3 scanned immediately
const MIN_TEXT_LENGTH = 20;   // Below this, treat as image-based PDF

// ─── Types ──────────────────────────────────────────────────────────────────

/** Basic metadata extracted from a PDF file. */
export interface PdfMetadata {
    fileName: string;
    pageCount: number;
    fileSize: number;
}

/** Lifecycle status of a PDF going through the document pipeline. */
export type PdfProcessingStatus =
    | 'PENDING'
    | 'METADATA'
    | 'TEXT_INDEXED'
    | 'OCR_COMPLETE'
    | 'FAILED';

/** Full result of processing one PDF: status, metadata, and searchable content. */
export interface PipelineResult {
    status: PdfProcessingStatus;
    metadata: PdfMetadata;
    content: string;            // Enriched searchable content
    detectionType: 'TEXT' | 'OBJECT' | 'EMPTY';
    pagesProcessed: number;
    classification: ClassificationResult;
    smartTitle: string;
}

// ─── Phase 1: Metadata Extraction ───────────────────────────────────────────

const extractMetadata = async (filePath: string): Promise<PdfMetadata> => {
    try {
        if (!NativePdfModule) {
            // Fallback if native module unavailable
            const stat = await RNFS.stat(filePath.replace('file://', ''));
            return {
                fileName: filePath.split('/').pop() || 'Unknown',
                pageCount: 0,
                fileSize: stat.size || 0,
            };
        }

        const info = await NativePdfModule.getPdfInfo(filePath);
        return {
            fileName: info.fileName || filePath.split('/').pop() || 'Unknown',
            pageCount: info.pageCount || 0,
            fileSize: info.fileSize || 0,
        };
    } catch (error) {
        AppLogger.warn('DocumentPipeline', 'Metadata extraction failed', error);
        return {
            fileName: filePath.split('/').pop() || 'Unknown',
            pageCount: 0,
            fileSize: 0,
        };
    }
};

// ─── Phase 2: Native Text Extraction ────────────────────────────────────────
//
// Reads the raw PDF bytes and attempts to extract text from content streams.
// PDF text objects live between BT (Begin Text) and ET (End Text) markers.
// Text is rendered via operators: Tj, TJ, ', "
//
// This is a lightweight heuristic — works for most digital PDFs (Word exports,
// browser-saved PDFs, bank statements) but not for encrypted or CMap-heavy PDFs.

const extractNativeText = async (filePath: string): Promise<string> => {
    try {
        const cleanPath = filePath.replace('file://', '');

        // Read first 200KB — enough to get text from first few pages
        const fileSize = (await RNFS.stat(cleanPath)).size;
        const bytesToRead = Math.min(fileSize, 200 * 1024);

        const rawContent = await RNFS.read(cleanPath, bytesToRead, 0, 'ascii');

        // Extract text between BT (Begin Text) and ET (End Text) blocks
        const textBlocks: string[] = [];
        const btEtRegex = /BT\s([\s\S]*?)ET/g;
        let match: RegExpExecArray | null;

        while ((match = btEtRegex.exec(rawContent)) !== null) {
            const block = match[1];

            // Extract Tj operator text: (Hello World) Tj
            const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g);
            if (tjMatches) {
                for (const tj of tjMatches) {
                    const textMatch = tj.match(/\(([^)]*)\)/);
                    if (textMatch) textBlocks.push(textMatch[1]);
                }
            }

            // Extract TJ operator text: [(Hello) -10 (World)] TJ
            const tjArrayMatches = block.match(/\[([^\]]*)\]\s*TJ/g);
            if (tjArrayMatches) {
                for (const tja of tjArrayMatches) {
                    const innerTexts = tja.match(/\(([^)]*)\)/g);
                    if (innerTexts) {
                        for (const inner of innerTexts) {
                            const cleaned = inner.replace(/[()]/g, '');
                            if (cleaned.trim()) textBlocks.push(cleaned);
                        }
                    }
                }
            }
        }

        // Clean and join extracted text
        const rawText = textBlocks
            .join(' ')
            .replace(/\\n/g, ' ')
            .replace(/\\r/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return rawText.substring(0, MAX_TOTAL_CHARS);
    } catch (error) {
        AppLogger.warn('DocumentPipeline', 'Native text extraction failed', error);
        return '';
    }
};

// ─── Phase 3 & 4: Rasterize + AI OCR ───────────────────────────────────────

const rasterizeAndOCR = async (
    filePath: string,
    maxPages: number,
): Promise<{ content: string; detectionType: 'TEXT' | 'OBJECT' | 'EMPTY'; pagesProcessed: number }> => {
    try {
        if (!NativePdfModule) {
            AppLogger.warn('DocumentPipeline', 'NativePdfModule not available, skipping rasterization');
            return { content: '', detectionType: 'EMPTY', pagesProcessed: 0 };
        }

        // Phase 3: Rasterize pages to JPEG images
        const imagePaths: string[] = await NativePdfModule.rasterizePages(filePath, maxPages);

        if (!imagePaths || imagePaths.length === 0) {
            return { content: '', detectionType: 'EMPTY', pagesProcessed: 0 };
        }

        // Phase 4: Run AI on each rasterized page
        const allContent: string[] = [];
        let primaryDetection: 'TEXT' | 'OBJECT' | 'EMPTY' = 'EMPTY';

        for (let i = 0; i < imagePaths.length; i++) {
            try {
                const imageUri = `file://${imagePaths[i]}`;
                const result = await analyzeImage(imageUri);

                if (result.content) {
                    // Truncate per-page content to prevent DB bloat
                    const pageContent = result.content.substring(0, MAX_CHARS_PER_PAGE);
                    allContent.push(pageContent);
                }

                // Use detection type from first page with results
                if (primaryDetection === 'EMPTY' && result.detection_type !== 'EMPTY') {
                    primaryDetection = result.detection_type;
                }
            } catch (pageError) {
                AppLogger.warn('DocumentPipeline', `OCR failed for page ${i + 1}`, pageError);
            }
        }

        // Cleanup rasterized images from cache
        try {
            await NativePdfModule.cleanupCache();
        } catch { /* non-critical */ }

        const combinedContent = allContent.join(' ').substring(0, MAX_TOTAL_CHARS);
        return {
            content: combinedContent,
            detectionType: primaryDetection,
            pagesProcessed: imagePaths.length,
        };
    } catch (error) {
        AppLogger.error('DocumentPipeline', 'Rasterize+OCR failed', error);
        return { content: '', detectionType: 'EMPTY', pagesProcessed: 0 };
    }
};

// ─── Phase 5: Enrichment + Indexing ─────────────────────────────────────────

const enrichAndIndex = (
    rawContent: string,
    metadata: PdfMetadata,
    filePath: string,
    detectionType: 'TEXT' | 'OBJECT' | 'EMPTY',
    status: PdfProcessingStatus,
): { classification: ClassificationResult; smartTitle: string } => {
    try {
        // Classify document type (zero-cost keyword matching)
        const classification = classifyDocument(rawContent, metadata.fileName);

        // Generate smart title from content + classification
        const smartTitle = extractSmartTitle(rawContent, metadata.fileName, classification);

        // Mask sensitive data (Aadhaar, PAN, phone) before storage
        const maskedContent = maskSensitiveData(rawContent);

        // Build search-optimized content
        const words = maskedContent.split(/\s+/).filter(Boolean);
        const latinWords = words.filter(w => /^[a-zA-Z]+$/.test(w));
        const soundexCodes = soundexAll(latinWords.join(' '));

        // Combine: smart title + category label + raw text + soundex codes
        const searchableContent = [
            smartTitle,
            classification.label,
            metadata.fileName.replace(/\.pdf$/i, ''),
            ...words,
            ...soundexCodes,
        ].join(' ').substring(0, MAX_TOTAL_CHARS);

        indexDocument(
            smartTitle,
            searchableContent || `Document: ${smartTitle}`,
            filePath,
            'DOCUMENT',
            detectionType === 'EMPTY' ? 'TEXT' : detectionType,
        );

        AppLogger.info('DocumentPipeline',
            `Indexed [${status}] ${classification.emoji} ${smartTitle} → ${classification.label} (${classification.confidence}% confidence, ${metadata.pageCount} pages)`);

        return { classification, smartTitle };
    } catch (error) {
        AppLogger.error('DocumentPipeline', 'Indexing failed', error);
        return {
            classification: { category: 'GENERAL_DOCUMENT', emoji: '📄', label: 'Document', confidence: 0 },
            smartTitle: metadata.fileName.replace(/\.pdf$/i, ''),
        };
    }
};

// ─── Main Pipeline Entry Point ──────────────────────────────────────────────

/**
 * Process a single PDF through the full 5-phase intelligence pipeline.
 *
 * @param filePath - Absolute path or file:// URI to the PDF
 * @returns PipelineResult with status, metadata, content, and detection info
 */
export const processPDF = async (filePath: string): Promise<PipelineResult> => {
    const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

    // ── Phase 1: Metadata ───────────────────────────────────────────────
    const metadata = await extractMetadata(fileUri);
    AppLogger.info('DocumentPipeline', `Phase 1 ✓ ${metadata.fileName} (${metadata.pageCount} pages)`);

    // ── Phase 2: Native Text Check ──────────────────────────────────────
    const nativeText = await extractNativeText(fileUri);

    if (nativeText.length >= MIN_TEXT_LENGTH) {
        // Digital PDF — skip OCR, still enrich with Soundex + classify
        AppLogger.info('DocumentPipeline', `Phase 2 ✓ Digital PDF — ${nativeText.length} chars extracted, skipping OCR`);

        const { classification, smartTitle } = enrichAndIndex(nativeText, metadata, fileUri, 'TEXT', 'TEXT_INDEXED');

        return {
            status: 'TEXT_INDEXED',
            metadata,
            content: nativeText,
            detectionType: 'TEXT',
            pagesProcessed: 0,
            classification,
            smartTitle,
        };
    }

    AppLogger.info('DocumentPipeline', 'Phase 2 → Image-based PDF detected, proceeding to OCR...');

    // ── Phase 3 & 4: Rasterize + AI OCR (pages 1–3) ────────────────────
    const pagesToScan = Math.min(FOREGROUND_PAGES, metadata.pageCount || FOREGROUND_PAGES);
    const ocrResult = await rasterizeAndOCR(fileUri, pagesToScan);

    // ── Phase 5: Index + Classify ───────────────────────────────────────
    const finalContent = ocrResult.content || `Document: ${metadata.fileName}`;
    const { classification, smartTitle } = enrichAndIndex(finalContent, metadata, fileUri, ocrResult.detectionType, 'OCR_COMPLETE');

    AppLogger.info('DocumentPipeline', `Phase 5 ✓ OCR complete — ${ocrResult.pagesProcessed} pages scanned`);

    return {
        status: 'OCR_COMPLETE',
        metadata,
        content: finalContent,
        detectionType: ocrResult.detectionType,
        pagesProcessed: ocrResult.pagesProcessed,
        classification,
        smartTitle,
    };
};
