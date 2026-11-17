import { NativeModules } from 'react-native';
import TextRecognition, { TextRecognitionScript } from '@react-native-ml-kit/text-recognition';
import ImageLabeling from '@react-native-ml-kit/image-labeling';
import ImageResizer from 'react-native-image-resizer';
import RNFS from 'react-native-fs';
import { AppLogger } from './AppLogger';
import { encodeImage } from '../services/EmbeddingService';
import { nextPlan, recordResult, type OcrScript } from './ScriptPlanner';

// ─── Types ───────────────────────────────────────────────────────────────────

/** What analyzeImage found in the picture. */
export type DetectionType = 'TEXT' | 'OBJECT' | 'EMPTY';

/** Structured result of the vision pipeline for one image. */
export interface VisionResult {
    detection_type: DetectionType;
    /** Original raw text extracted before any enrichment */
    raw_text: string;
    /** The words (or labels), space-joined: what is stored and shown. Search keys are added at index time (SearchKeys). */
    content: string;
    /** The same words (or labels) as a list. */
    search_index: string[];
    /** Audit field — tells whether object detection ran or was bypassed */
    optimized_status: string;
    /** 512-dim MobileCLIP embedding vector (null if encoding failed, or not asked for) */
    embedding: Float32Array | null;
}

export interface AnalyzeOptions {
    /**
     * Also make the CLIP vector (default). Only gallery sync stores one: PDF
     * pages and Scan pass false, so they don't load and run the image encoder
     * for a vector nobody keeps.
     */
    embed?: boolean;
}

const MIN_TEXT_LENGTH = 3;

// ─── OCR Garbage Filter ──────────────────────────────────────────────────────
// Rejects garbled text from blurry images / low-quality OCR output

const isGarbageText = (text: string): boolean => {
    if (!text || text.length < MIN_TEXT_LENGTH) return true;

    // Check 1: At least 30% of characters should be alphanumeric or Devanagari
    const cleanChars = text.replace(/[^a-zA-Z0-9\u0900-\u097F\s]/g, '');
    const alphaRatio = cleanChars.length / text.length;
    if (alphaRatio < 0.3) return true;

    // Check 2: Reject if mostly single-char "words" (OCR noise)
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 3) {
        const singleCharWords = words.filter(w => w.length === 1).length;
        if (singleCharWords / words.length > 0.6) return true;
    }

    return false;
};

// ─── Step 1: OCR ─────────────────────────────────────────────────────────────

const runOCR = async (uri: string): Promise<{ latin: string; hindi: string }> => {
    // Run Latin and Devanagari in parallel — both are lightweight ML Kit models
    const [latinRes, devaRes] = await Promise.allSettled([
        TextRecognition.recognize(uri, TextRecognitionScript.LATIN),
        TextRecognition.recognize(uri, TextRecognitionScript.DEVANAGARI),
    ]);
    return {
        latin: latinRes.status === 'fulfilled' ? latinRes.value.text?.trim() ?? '' : '',
        hindi: devaRes.status === 'fulfilled' ? devaRes.value.text?.trim() ?? '' : '',
    };
};

// ─── Step 1, one decode: the native PhotoReader ──────────────────────────────

interface PhotoReaderResult {
    results: Array<{ script: OcrScript; text: string; lines?: Array<{ text: string; confidence?: number }> }>;
    labels?: Array<{ text: string; confidence: number }>;
}

/** PhotoReader labels the photo (from the same bitmap) when it holds fewer letters than this. */
const LABEL_BELOW_CHARS = 20;

const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * The words in a photo from one decode (PhotoReaderModule.kt), with the
 * scripts ScriptPlanner chose. When both ran, only the Devanagari pass's lines
 * that hold Devanagari are kept from it: it reads English too, and the
 * English words would otherwise be stored twice. null when the module isn't
 * there or fails: the caller falls back to the old path.
 */
export const readWithPhotoReader = async (
    uri: string,
): Promise<{ latin: string; hindi: string; labels: string[] } | null> => {
    const reader = NativeModules.PhotoReader as
        | { readText?: (uri: string, plan: object) => Promise<PhotoReaderResult> }
        | undefined;
    if (!reader?.readText) return null;
    try {
        const plan = await nextPlan();
        const read = await reader.readText(uri, { ...plan, labelBelowChars: LABEL_BELOW_CHARS });
        const labels = (read.labels ?? []).map(l => l.text).filter(Boolean);
        const latin = read.results.find(r => r.script === 'latin')?.text?.trim() ?? '';
        const deva = read.results.find(r => r.script === 'devanagari');
        await recordResult(deva ? deva.text ?? '' : null);
        if (!deva) return { latin, hindi: '', labels };
        const lines = deva.lines?.map(l => l.text) ?? (deva.text ?? '').split('\n');
        const hindi = (latin ? lines.filter(l => DEVANAGARI.test(l)) : lines).join('\n').trim();
        return { latin, hindi, labels };
    } catch (e) {
        AppLogger.warn('VisionPipeline', 'PhotoReader failed, using the old path', e);
        return null;
    }
};

// ─── Step 3: Object/Scene Labeling (fallback only) ───────────────────────────

const runLabeling = async (uri: string): Promise<string[]> => {
    try {
        const results = await ImageLabeling.label(uri);
        return results
            .filter(l => l.confidence >= 0.50)   // wider net
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 7)                          // up to 7 labels
            .map(l => l.text);
    } catch {
        return [];
    }
};


/**
 * Everything after the words are read: the CLIP vector (when asked for), then
 * text or, for a photo without clean text, labels. `uri` is the image both
 * read from.
 */
const finishAnalysis = async (
    uri: string,
    latin: string,
    hindi: string,
    readLabels: () => Promise<string[]>,
    embed: boolean,
): Promise<VisionResult> => {
    const combinedText = [latin, hindi].filter(Boolean).join(' ').trim();

    // ── Step 4: Generate semantic embedding ────────────────────────────
    let embedding: Float32Array | null = null;
    if (embed) {
        try {
            embedding = await encodeImage(uri);
        } catch {
            // Non-fatal — image still searchable via text/labels
        }
    }

    // ── Step 2: Early exit if CLEAN text found ──────────────────────────────
    if (combinedText.length >= MIN_TEXT_LENGTH && !isGarbageText(combinedText)) {
        const words = combinedText.split(/\s+/).filter(Boolean);
        return {
            detection_type: 'TEXT',
            raw_text: combinedText,
            search_index: words,
            content: words.join(' '),
            optimized_status: 'Object_Detection_Bypassed: True',
            embedding,
        };
    }

    // ── Step 3: Fallback — Object/Scene Recognition ───────────────────────────
    const labels = await readLabels();

    if (labels.length > 0) {
        return {
            detection_type: 'OBJECT',
            raw_text: labels.join(', '),
            search_index: labels,
            content: labels.join(' '),
            optimized_status: 'Object_Detection_Bypassed: False',
            embedding,
        };
    }

    return {
        detection_type: 'EMPTY',
        raw_text: '',
        search_index: [],
        content: '',
        optimized_status: 'Object_Detection_Bypassed: False',
        embedding,
    };
};

// ─── Main Pipeline ────────────────────────────────────────────────────────────

/**
 * SEQUENTIAL VISION PIPELINE
 *
 * 1. OCR (LATIN + DEVANAGARI in parallel)   ← always runs
 * 2. Text found? → Early exit              ← object detection SKIPPED → battery saved
 * 3. No text?   → ImageLabeling fallback   ← top 3 labels at ≥60% confidence
 *
 * Returns a structured VisionResult with:
 *  - detection_type: 'TEXT' | 'OBJECT' | 'EMPTY'
 *  - search_index:   the words (or labels)
 *  - content:        the same, space-joined, as stored and shown
 *  - optimized_status: audit string
 *  - embedding:      the CLIP vector, unless `embed: false`
 */
export const analyzeImage = async (originalUri: string, { embed = true }: AnalyzeOptions = {}): Promise<VisionResult> => {
    // One decode, readable screenshots, background threads (native).
    const native = await readWithPhotoReader(originalUri);
    // Its labels came from the same bitmap; asking ML Kit's file loader for
    // them would decode the full original.
    if (native) return finishAnalysis(originalUri, native.latin, native.hindi, async () => native.labels, embed);

    let processUri = originalUri;

    // ── Step 0: Downsample Image (Massive speed boost for ML Kit) ──────────────
    try {
        const resized = await ImageResizer.createResizedImage(
            originalUri,
            1024,
            1024,
            'JPEG',
            80,
            0,
            undefined,
            false,
            { mode: 'contain' }
        );
        processUri = resized.uri;
    } catch (resizeError) {
        // Soft fail — continue with raw 12MP image if resizer fails for some reason
        AppLogger.warn('VisionPipeline', 'Resize failed, using full resolution:', resizeError);
    }

    // H5 fix: wrap in try/finally to clean up resized temp file
    try {
        // ── Step 1: OCR ────────────────────────────────────────────────────────────
        const { latin, hindi } = await runOCR(processUri);
        return await finishAnalysis(processUri, latin, hindi, () => runLabeling(processUri), embed);
    } finally {
        // H5 fix: delete ImageResizer temp file to prevent unbounded cache growth
        if (processUri !== originalUri) {
            try {
                await RNFS.unlink(processUri.replace('file://', ''));
            } catch {
                // Ignore — temp file may already be cleaned up
            }
        }
    }
};
