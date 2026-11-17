/**
 * VisionPipeline.test.ts — exhaustive unit tests for the sequential vision pipeline.
 *
 * Pipeline under test (src/utils/VisionPipeline.ts):
 *   0. Downsample via ImageResizer (soft-fail → original URI)
 *   1. OCR LATIN + DEVANAGARI in parallel (Promise.allSettled → '' on reject)
 *   2. encodeImage embedding (null on failure — non-fatal)
 *   3. Clean text → early exit (TEXT, object detection BYPASSED)
 *   4. Garbage/empty text → ImageLabeling fallback (OBJECT) or EMPTY
 *   finally: delete the ImageResizer temp file (only when resized URI differs)
 *
 * Mock control: the four module mocks below are auto-applied from __mocks__/,
 * and NativeModules.MobileCLIPModule is stubbed in jest.setup.js.
 */
import { NativeModules } from 'react-native';
import TextRecognition, { TextRecognitionScript } from '@react-native-ml-kit/text-recognition';
import ImageLabeling from '@react-native-ml-kit/image-labeling';
import ImageResizer from 'react-native-image-resizer';
import RNFS from 'react-native-fs';
import { analyzeImage } from '../VisionPipeline';

// ─── Mock handles ────────────────────────────────────────────────────────────
const recognizeMock = TextRecognition.recognize as jest.Mock;
const labelMock = ImageLabeling.label as jest.Mock;
const resizeMock = ImageResizer.createResizedImage as jest.Mock;
const unlinkMock = RNFS.unlink as jest.Mock;
const encodeImageNative = NativeModules.MobileCLIPModule.encodeImage as jest.Mock;

// NOTE: the jest mock of @react-native-ml-kit/text-recognition exposes
// LATIN='latin' / DEVANAGARI='devanagari' (lowercase), unlike the real enum.
const LATIN_SCRIPT = TextRecognitionScript.LATIN as unknown as string;
const DEVANAGARI_SCRIPT = TextRecognitionScript.DEVANAGARI as unknown as string;

const IMG = 'file:///photos/IMG_20260929.jpg';
const RESIZED = 'file:///cache/vision-9f3a2c.jpg';

// ─── Test helpers ────────────────────────────────────────────────────────────
/** OCR mock: LATIN returns `latin`, DEVANAGARI returns `hindi`. */
const setOCR = (latin: string, hindi = ''): void => {
    recognizeMock.mockImplementation(async (_uri: string, script: string) =>
        script === LATIN_SCRIPT ? { text: latin } : { text: hindi },
    );
};

/** Labeling mock with explicit (text, confidence) pairs. */
const setLabels = (labels: Array<{ text: string; confidence: number }>): void => {
    labelMock.mockResolvedValue(labels);
};

/** Resizer mock that returns a DIFFERENT uri (triggers the temp-cleanup path). */
const setResizedUri = (resizedUri: string): void => {
    resizeMock.mockResolvedValue({ uri: resizedUri, path: resizedUri, name: 'resized.jpg', size: 1024 });
};

beforeEach(() => {
    jest.clearAllMocks();
    // Deterministic defaults (clearAllMocks only clears calls, but we re-apply
    // implementations explicitly so no test leaks state into the next).
    recognizeMock.mockResolvedValue({ text: '' });
    labelMock.mockResolvedValue([]);
    resizeMock.mockImplementation(async (uri: string) => ({
        uri,
        path: uri,
        name: 'resized.jpg',
        size: 1024,
    }));
    unlinkMock.mockResolvedValue(undefined);
    encodeImageNative.mockResolvedValue([]);
});

// ══════════════════════════════════════════════════════════════════════════════
describe('VisionPipeline — analyzeImage', () => {
    // ── Happy path: clean Latin OCR → TEXT with early exit ────────────────────
    describe('TEXT happy path (early exit)', () => {
        test('clean Latin OCR returns TEXT and bypasses object detection', async () => {
            setOCR('Hello World');
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.raw_text).toBe('Hello World');
            expect(result.optimized_status).toBe('Object_Detection_Bypassed: True');
            expect(labelMock).not.toHaveBeenCalled();
        });

        test('content is only the words read: no Soundex codes in what is shown or copied', async () => {
            setOCR('Hello World');
            const result = await analyzeImage(IMG);

            // The codes are added to the hidden search tail at index time (SearchKeys).
            expect(result.search_index).toEqual(['Hello', 'World']);
            expect(result.content).toBe('Hello World');
        });

        test('embedding is a Float32Array when MobileCLIP encoding succeeds', async () => {
            setOCR('Hello World');
            encodeImageNative.mockResolvedValue(new Array(512).fill(0.25));
            const result = await analyzeImage(IMG);

            expect(result.embedding).toBeInstanceOf(Float32Array);
            expect(result.embedding!.length).toBe(512);
        });

        test('OCR is invoked twice — once per script (LATIN + DEVANAGARI)', async () => {
            setOCR('Hello World', 'नमस्ते');
            await analyzeImage(IMG);

            expect(recognizeMock).toHaveBeenCalledTimes(2);
            const scripts = recognizeMock.mock.calls.map((c) => c[1]);
            expect(scripts).toContain(LATIN_SCRIPT);
            expect(scripts).toContain(DEVANAGARI_SCRIPT);
        });

        test('ImageResizer is called with the documented downsample args', async () => {
            setOCR('Hello World');
            await analyzeImage(IMG);

            expect(resizeMock).toHaveBeenCalledWith(
                IMG, 1024, 1024, 'JPEG', 80, 0, undefined, false, { mode: 'contain' },
            );
        });

        test('OCR whitespace is trimmed before the pipeline proceeds', async () => {
            setOCR('   Hello World   ');
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.raw_text).toBe('Hello World');
            expect(result.search_index).toEqual(['Hello', 'World']);
        });

        test('latin + hindi texts are joined with a single space', async () => {
            setOCR('Invoice', 'चालान');
            const result = await analyzeImage(IMG);

            expect(result.raw_text).toBe('Invoice चालान');
            expect(result.detection_type).toBe('TEXT');
        });

        test('3-char text passes MIN_TEXT_LENGTH (boundary: length >= 3)', async () => {
            setOCR('Hey');
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.raw_text).toBe('Hey');
            expect(labelMock).not.toHaveBeenCalled();
        });
    });

    // ── Multilingual: Devanagari handling + soundex scoping ───────────────────
    describe('multilingual / Devanagari path', () => {
        test('Devanagari-only OCR returns TEXT with no soundex codes', async () => {
            setOCR('', 'नमस्ते दुनिया');
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.raw_text).toBe('नमस्ते दुनिया');
            expect(result.search_index).toEqual(['नमस्ते', 'दुनिया']);
            expect(result.content).toBe('नमस्ते दुनिया');
        });

        test('Latin and Devanagari words are kept as read', async () => {
            setOCR('Hello', 'नमस्ते');
            const result = await analyzeImage(IMG);

            expect(result.search_index).toEqual(['Hello', 'नमस्ते']);
            expect(result.content).toBe('Hello नमस्ते');
        });

        test('alphanumeric words (e.g. Invoice123) are kept as one word', async () => {
            setOCR('Invoice123');
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.search_index).toEqual(['Invoice123']);
            expect(result.content).toBe('Invoice123');
        });

        test('empty LATIN result does not poison a valid DEVANAGARI result', async () => {
            setOCR('', 'मुंबई');
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.raw_text).toBe('मुंबई');
            expect(labelMock).not.toHaveBeenCalled();
        });

        test('search_index is the words, in order', async () => {
            setOCR('Electricity Bill Receipt');
            const result = await analyzeImage(IMG);

            expect(result.search_index).toEqual(['Electricity', 'Bill', 'Receipt']);
        });
    });

    // ── Garbage filter → fallback to labeling ─────────────────────────────────
    describe('garbage-text filter (falls through to labeling)', () => {
        test('symbol soup "### $$$ @@@ " is treated as no-text → labeling runs', async () => {
            setOCR('### $$$ @@@');
            setLabels([{ text: 'Tree', confidence: 0.8 }]);
            const result = await analyzeImage(IMG);

            expect(labelMock).toHaveBeenCalled();
            expect(result.detection_type).toBe('OBJECT');
        });

        test('single-char noise "a b c d e f" is treated as no-text', async () => {
            setOCR('a b c d e f');
            setLabels([{ text: 'Paper', confidence: 0.9 }]);
            const result = await analyzeImage(IMG);

            expect(labelMock).toHaveBeenCalled();
            expect(result.detection_type).toBe('OBJECT');
            expect(result.raw_text).toBe('Paper');
        });

        test('2-char text fails MIN_TEXT_LENGTH → fallback', async () => {
            setOCR('Hi');
            setLabels([{ text: 'Phone', confidence: 0.85 }]);
            const result = await analyzeImage(IMG);

            expect(labelMock).toHaveBeenCalled();
            expect(result.detection_type).toBe('OBJECT');
        });

        test('empty OCR output falls back to labeling', async () => {
            setOCR('');
            setLabels([{ text: 'Car', confidence: 0.77 }]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('OBJECT');
        });

        test('whitespace-only OCR output falls back to labeling', async () => {
            setOCR('    ');
            setLabels([{ text: 'Car', confidence: 0.77 }]);
            const result = await analyzeImage(IMG);

            expect(labelMock).toHaveBeenCalled();
            expect(result.detection_type).toBe('OBJECT');
        });

        test('recognize resolving without a text key is treated as empty', async () => {
            recognizeMock.mockResolvedValue({});
            setLabels([{ text: 'Book', confidence: 0.6 }]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('OBJECT');
        });

        test('low alpha-ratio mixed junk triggers the garbage filter', async () => {
            // <30% alphanumeric/Devanagari → garbage
            setOCR('###!!!@@@$$$%%%^^^');
            setLabels([{ text: 'Desk', confidence: 0.66 }]);
            const result = await analyzeImage(IMG);

            expect(labelMock).toHaveBeenCalled();
            expect(result.detection_type).toBe('OBJECT');
        });
    });

    // ── OBJECT fallback path ──────────────────────────────────────────────────
    describe('OBJECT fallback (ImageLabeling)', () => {
        test('labels below 0.50 confidence are dropped, rest sorted desc', async () => {
            setOCR('');
            setLabels([
                { text: 'Cat', confidence: 0.95 },
                { text: 'Dog', confidence: 0.30 }, // dropped
                { text: 'Pet', confidence: 0.72 },
                { text: 'Animal', confidence: 0.55 },
                { text: 'Mammal', confidence: 0.88 },
            ]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('OBJECT');
            expect(result.raw_text).toBe('Cat, Mammal, Pet, Animal');
            expect(result.search_index.slice(0, 4)).toEqual(['Cat', 'Mammal', 'Pet', 'Animal']);
            expect(result.search_index).not.toContain('Dog');
        });

        test('confidence exactly 0.50 is kept, 0.49 is dropped (boundary)', async () => {
            setOCR('');
            setLabels([
                { text: 'Keep', confidence: 0.5 },
                { text: 'Drop', confidence: 0.49 },
            ]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('OBJECT');
            expect(result.raw_text).toBe('Keep');
        });

        test('at most 7 labels are kept when more are returned', async () => {
            setOCR('');
            setLabels(
                Array.from({ length: 9 }, (_, i) => ({
                    text: `Label${i + 1}`,
                    confidence: 0.99 - i * 0.01,
                })),
            );
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('OBJECT');
            expect(result.raw_text).toBe('Label1, Label2, Label3, Label4, Label5, Label6, Label7');
            expect(result.raw_text).not.toContain('Label8');
            expect(result.raw_text).not.toContain('Label9');
        });

        test('OBJECT result shape: index, content, status, embedding', async () => {
            setOCR('');
            const labels = ['Coffee', 'Cup'];
            setLabels([
                { text: 'Coffee', confidence: 0.9 },
                { text: 'Cup', confidence: 0.8 },
            ]);
            encodeImageNative.mockResolvedValue([0.1, 0.2]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('OBJECT');
            expect(result.raw_text).toBe('Coffee, Cup');
            expect(result.search_index).toEqual(labels);
            expect(result.content).toBe('Coffee Cup');
            expect(result.optimized_status).toBe('Object_Detection_Bypassed: False');
            expect(result.embedding).toBeInstanceOf(Float32Array);
        });
    });

    // ── EMPTY path ────────────────────────────────────────────────────────────
    describe('EMPTY path', () => {
        test('no text and no labels → EMPTY with empty index/content', async () => {
            setOCR('');
            setLabels([]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('EMPTY');
            expect(result.raw_text).toBe('');
            expect(result.search_index).toEqual([]);
            expect(result.content).toBe('');
            expect(result.optimized_status).toBe('Object_Detection_Bypassed: False');
        });

        test('all labels below threshold → EMPTY', async () => {
            setOCR('');
            setLabels([
                { text: 'Blur', confidence: 0.2 },
                { text: 'Noise', confidence: 0.1 },
            ]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('EMPTY');
            expect(result.search_index).toEqual([]);
        });

        test('EMPTY still attempts embedding (null when encoding fails)', async () => {
            setOCR('');
            setLabels([]);
            encodeImageNative.mockRejectedValue(new Error('no model'));
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('EMPTY');
            expect(result.embedding).toBeNull();
        });
    });

    // ── Error paths ───────────────────────────────────────────────────────────
    describe('error handling', () => {
        test('LATIN OCR rejects → treated as empty, valid hindi still yields TEXT', async () => {
            recognizeMock.mockImplementation(async (_uri: string, script: string) => {
                if (script === LATIN_SCRIPT) throw new Error('mlkit latin crashed');
                return { text: 'नमस्ते' };
            });
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.raw_text).toBe('नमस्ते');
            expect(labelMock).not.toHaveBeenCalled();
        });

        test('both OCR scripts reject → falls back to labeling (no throw)', async () => {
            recognizeMock.mockRejectedValue(new Error('mlkit down'));
            setLabels([{ text: 'Chair', confidence: 0.7 }]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('OBJECT');
            expect(result.raw_text).toBe('Chair');
        });

        test('ImageLabeling.label rejects → caught → EMPTY, no throw', async () => {
            setOCR('');
            labelMock.mockRejectedValue(new Error('labeler crashed'));
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('EMPTY');
            expect(result.search_index).toEqual([]);
        });

        test('MobileCLIP encodeImage rejects → embedding null but TEXT still returned', async () => {
            setOCR('Hello World');
            encodeImageNative.mockRejectedValue(new Error('clip not loaded'));
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.embedding).toBeNull();
            expect(result.search_index).toEqual(['Hello', 'World']);
        });

        test('embed: false reads the words and never runs CLIP (PDF pages, Scan)', async () => {
            setOCR('Hello World');
            const result = await analyzeImage(IMG, { embed: false });

            expect(result.detection_type).toBe('TEXT');
            expect(result.raw_text).toBe('Hello World');
            expect(result.embedding).toBeNull();
            expect(encodeImageNative).not.toHaveBeenCalled();
        });

        test('ImageResizer rejects → soft fail: continues with original URI', async () => {
            resizeMock.mockRejectedValue(new Error('OOM'));
            setOCR('Hello World');
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            // OCR + embedding ran against the ORIGINAL uri, not a resized one
            expect(recognizeMock).toHaveBeenCalledWith(IMG, LATIN_SCRIPT);
            expect(encodeImageNative).toHaveBeenCalledWith(IMG);
        });

        test('resize failure never attempts temp-file cleanup', async () => {
            resizeMock.mockRejectedValue(new Error('OOM'));
            setOCR('Hello World');
            await analyzeImage(IMG);

            expect(unlinkMock).not.toHaveBeenCalled();
        });

        test('resize failure logs a console.warn (soft-fail audit trail)', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            resizeMock.mockRejectedValue(new Error('OOM'));
            setOCR('Hello World');
            await analyzeImage(IMG);

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Resize failed'),
                expect.anything(),
            );
            warnSpy.mockRestore();
        });
    });

    // ── Temp-file cleanup ─────────────────────────────────────────────────────
    describe('resized temp-file cleanup', () => {
        test('when resize returns a different URI, RNFS.unlink is called on the stripped path', async () => {
            setResizedUri(RESIZED);
            setOCR('Hello World');
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(unlinkMock).toHaveBeenCalledTimes(1);
            // 'file://' prefix is stripped before unlink
            expect(unlinkMock).toHaveBeenCalledWith('/cache/vision-9f3a2c.jpg');
        });

        test('OCR and embedding run against the RESIZED uri, not the original', async () => {
            setResizedUri(RESIZED);
            setOCR('Hello World');
            await analyzeImage(IMG);

            expect(recognizeMock).toHaveBeenCalledWith(RESIZED, LATIN_SCRIPT);
            expect(recognizeMock).toHaveBeenCalledWith(RESIZED, DEVANAGARI_SCRIPT);
            expect(encodeImageNative).toHaveBeenCalledWith(RESIZED);
            expect(recognizeMock).not.toHaveBeenCalledWith(IMG, expect.anything());
        });

        test('cleanup also runs on the OBJECT path (finally block)', async () => {
            setResizedUri(RESIZED);
            setOCR('');
            setLabels([{ text: 'Lamp', confidence: 0.9 }]);
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('OBJECT');
            expect(unlinkMock).toHaveBeenCalledWith('/cache/vision-9f3a2c.jpg');
        });

        test('unlink failure is swallowed — result is still returned', async () => {
            setResizedUri(RESIZED);
            setOCR('Hello World');
            unlinkMock.mockRejectedValue(new Error('already deleted'));
            const result = await analyzeImage(IMG);

            expect(result.detection_type).toBe('TEXT');
            expect(result.raw_text).toBe('Hello World');
        });

        test('default mock (same URI back) → no cleanup attempted', async () => {
            setOCR('Hello World');
            await analyzeImage(IMG);

            expect(unlinkMock).not.toHaveBeenCalled();
        });
    });

    // ── Concurrency ───────────────────────────────────────────────────────────
    describe('concurrent calls', () => {
        test('parallel analyzeImage calls do not cross-contaminate', async () => {
            recognizeMock.mockImplementation(async (uri: string, script: string) => {
                if (script !== LATIN_SCRIPT) return { text: '' };
                return { text: uri.includes('img-a') ? 'Alpha Document' : 'Beta Document' };
            });
            encodeImageNative.mockImplementation(async (uri: string) =>
                uri.includes('img-a') ? [1, 2, 3] : [4, 5, 6],
            );

            const [ra, rb] = await Promise.all([
                analyzeImage('file:///photos/img-a.jpg'),
                analyzeImage('file:///photos/img-b.jpg'),
            ]);

            expect(ra.detection_type).toBe('TEXT');
            expect(rb.detection_type).toBe('TEXT');
            expect(ra.raw_text).toBe('Alpha Document');
            expect(rb.raw_text).toBe('Beta Document');
            expect(Array.from(ra.embedding!)).toEqual([1, 2, 3]);
            expect(Array.from(rb.embedding!)).toEqual([4, 5, 6]);
            expect(ra.search_index).not.toContain('Beta');
            expect(rb.search_index).not.toContain('Alpha');
        });
    });
});

describe('analyzeImage — one decode with the native PhotoReader', () => {
    const readText = jest.fn();
    beforeEach(async () => {
        jest.requireActual('../ScriptPlanner').__resetScriptPlanner();
        (NativeModules as Record<string, unknown>).PhotoReader = { readText };
        readText.mockReset();
    });
    afterEach(() => {
        delete (NativeModules as Record<string, unknown>).PhotoReader;
    });

    it('reads the original once: no resized copy, CLIP gets the original too', async () => {
        readText.mockResolvedValue({ results: [{ script: 'latin', text: 'Electricity bill amount 1240' }, { script: 'devanagari', text: '' }] });
        const result = await analyzeImage(IMG);
        expect(resizeMock).not.toHaveBeenCalled();
        expect(recognizeMock).not.toHaveBeenCalled();
        expect(readText).toHaveBeenCalledWith(IMG, expect.objectContaining({ scripts: ['latin', 'devanagari'], labelBelowChars: 20 }));
        expect(encodeImageNative).toHaveBeenCalledWith(IMG);
        expect(result.detection_type).toBe('TEXT');
        expect(result.raw_text).toBe('Electricity bill amount 1240');
    });

    it('skips CLIP with embed: false', async () => {
        readText.mockResolvedValue({ results: [{ script: 'latin', text: 'Electricity bill amount 1240' }] });
        const result = await analyzeImage(IMG, { embed: false });
        expect(encodeImageNative).not.toHaveBeenCalled();
        expect(result.embedding).toBeNull();
        expect(result.raw_text).toBe('Electricity bill amount 1240');
    });

    it('keeps only the Hindi lines of the Devanagari pass, so English is not stored twice', async () => {
        readText.mockResolvedValue({
            results: [
                { script: 'latin', text: 'Electricity bill' },
                { script: 'devanagari', text: 'बिजली बिल\nElectricity bill', lines: [{ text: 'बिजली बिल' }, { text: 'Electricity bill' }] },
            ],
        });
        const result = await analyzeImage(IMG);
        expect(result.raw_text).toBe('Electricity bill बिजली बिल');
    });

    it('uses the labels it made from the same bitmap, never ML Kit\'s full-size file loader', async () => {
        readText.mockResolvedValue({ results: [{ script: 'latin', text: '' }, { script: 'devanagari', text: '' }], labels: [{ text: 'Dog', confidence: 0.9 }] });
        const result = await analyzeImage(IMG);
        expect(labelMock).not.toHaveBeenCalled();
        expect(result.detection_type).toBe('OBJECT');
        expect(result.raw_text).toBe('Dog');
    });

    it('falls back to the old path when PhotoReader fails', async () => {
        readText.mockRejectedValue(new Error('decode failed'));
        setResizedUri(RESIZED);
        setOCR('Bill text here');
        const result = await analyzeImage(IMG);
        expect(resizeMock).toHaveBeenCalled();
        expect(result.raw_text).toBe('Bill text here');
    });
});
