/**
 * download-models.js — Build-time script to download the sherpa-onnx AAR and speech model.
 * 
 * Downloads:
 *   1. sherpa-onnx Android AAR
 *   2. Whisper Base (English, INT8 quantized) for STT. Only the three files
 *      the app loads are kept (161 MB); the rest of the archive is removed.
 *   3. indic-lekhan (Hindi streaming transducer, INT8, 640 ms chunks) for
 *      Hindi voice search: about 28 MB, pinned to one revision and checked
 *      against SHA-256 sums. Its bpe.vocab (for hotwords) is made here from
 *      the model's bpe.model.
 *
 * The MobileCLIP2-S0 models are not downloaded: scripts/export_mobileclip.py
 * makes them.
 * 
 * Models are placed into android/app/src/main/assets/models/
 * AAR is placed into android/app/libs/
 * 
 * Run via: node download-models.js
 * Triggered automatically by: npm postinstall
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');

// ─── Configuration ──────────────────────────────────────────────────

// sherpa-onnx and the app's own ONNX Runtime (onnxruntime-android, used for
// CLIP) must be built for the SAME ONNX Runtime version: an APK holds one
// libonnxruntime.so, and each library asks for it by exact version tag.
// sherpa-onnx 1.13.4 is built against ONNX Runtime 1.27.0, which is the
// onnxruntime-android version in android/app/build.gradle. Change both
// together (see CLAUDE.md), never one alone.
const SHERPA_ONNX_VERSION = '1.13.4';

/** The speech model files SherpaOnnxModule.kt loads. Keep the two lists in step. */
const WHISPER_FILES = ['base.en-encoder.int8.onnx', 'base.en-decoder.int8.onnx', 'base.en-tokens.txt'];

// Hindi voice search: indic-lekhan by Henil1 (CC BY 4.0, trained on AI4Bharat's
// IndicVoices, Kathbath and Shrutilipi, also CC BY 4.0). One revision, with the
// SHA-256 of every file: a changed upload never reaches a phone unnoticed.
const HINDI_REVISION = 'd13a34654cf84f5db266d3e36737f9f22e1183f4';
const HINDI_BASE = `https://huggingface.co/Henil1/indic-lekhan/resolve/${HINDI_REVISION}`;
const HINDI_DIR = path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'models', 'hindi');
const HINDI_DOWNLOADS = [
    { name: 'encoder.int8.onnx', url: `${HINDI_BASE}/640ms/encoder.int8.onnx`, sha256: 'ff41c9251933ae3623b014ce42b502b9ade32d7646330286bdf3992d6aee85b9' },
    { name: 'decoder.int8.onnx', url: `${HINDI_BASE}/640ms/decoder.int8.onnx`, sha256: 'ffd6830adb9da04c91dfea514a8a5b546ee55dd3b0d61e82cb61ed1966db4100' },
    { name: 'joiner-hi.int8.onnx', url: `${HINDI_BASE}/640ms/joiner-hi.int8.onnx`, sha256: 'c78586bd1b181b739c68dde3ce1b966176bd56044ab9401a6ebd70eee167d0ed' },
    { name: 'tokens.txt', url: `${HINDI_BASE}/640ms/tokens.txt`, sha256: '7b954984d94ed30f54a41e1f24e397f97c81d77bf0436f1102b05fe2d5605c67' },
];
/** Read to make bpe.vocab, then deleted: it is not loaded by the app. */
const HINDI_BPE_MODEL = { url: `${HINDI_BASE}/bpe.model`, sha256: 'd5eed0cf4ddfbd8afa7a435b6c9e575df6810efdd6569b17b62f0920803a540b' };
const HINDI_NOTICE = [
    'Hindi speech recognition: indic-lekhan by Henil1',
    'https://huggingface.co/Henil1/indic-lekhan (revision ' + HINDI_REVISION + ')',
    'License: Creative Commons Attribution 4.0 (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/',
    'Trained on AI4Bharat IndicVoices, Kathbath and Shrutilipi (CC BY 4.0).',
    'Used unchanged; bpe.vocab is derived from the model\'s bpe.model for hotwords.',
    '',
].join('\n');
/** The Hindi model files SherpaOnnxModule.kt loads (and the notice). Keep the two lists in step. */
const HINDI_FILES = [...HINDI_DOWNLOADS.map((f) => f.name), 'bpe.vocab'];
const HINDI_KEEP = [...HINDI_FILES, 'NOTICE.txt'];

const MODELS = [
    {
        name: 'sherpa-onnx AAR',
        url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_ONNX_VERSION}/sherpa-onnx-${SHERPA_ONNX_VERSION}.aar`,
        dest: path.join(__dirname, 'android', 'app', 'libs', `sherpa-onnx-${SHERPA_ONNX_VERSION}.aar`),
        type: 'file',
    },
    {
        name: 'Whisper Base EN (INT8) — STT',
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2',
        extractTo: path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'models', 'whisper'),
        type: 'archive',
        // Everything in this folder goes into the APK. The archive also holds
        // the float32 models (292 MB) and sample recordings, which the app
        // never opens: SherpaOnnxModule.kt loads exactly these three files.
        keep: WHISPER_FILES,
    },
    {
        name: 'indic-lekhan Hindi streaming (INT8, 640 ms) — Hindi STT',
        type: 'hindi',
    },
    // MobileCLIP2-S0 models are exported via scripts/export_mobileclip.py
    // and placed manually into android/app/src/main/assets/models/clip/
    // (App has no internet permission — all models bundled in APK)
    // {
    //     name: 'MobileCLIP2-S0 Vision Encoder (INT8)',
    //     url: 'https://huggingface.co/ppointer/mobileclip2-s0-onnx/resolve/main/vision_encoder_int8.onnx',
    //     dest: path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'models', 'clip', 'vision_encoder.onnx'),
    //     type: 'file',
    // },
    // {
    //     name: 'MobileCLIP2-S0 Text Encoder (INT8)',
    //     url: 'https://huggingface.co/ppointer/mobileclip2-s0-onnx/resolve/main/text_encoder_int8.onnx',
    //     dest: path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'models', 'clip', 'text_encoder.onnx'),
    //     type: 'file',
    // },
    // {
    //     name: 'OpenCLIP BPE Vocabulary',
    //     url: 'https://huggingface.co/ppointer/mobileclip2-s0-onnx/resolve/main/bpe_simple_vocab_16e6.txt',
    //     dest: path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'models', 'clip', 'bpe_simple_vocab_16e6.txt'),
    //     type: 'file',
    // },
    // TTS models removed — not needed for Pinpointer's search flow.
    // Uncomment to re-enable TTS (adds ~155 MB to APK):
    // {
    //     name: 'Piper VITS en_US-lessac-medium — English TTS',
    //     url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2',
    //     extractTo: path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'models', 'piper'),
    //     type: 'archive',
    // },
    // {
    //     name: 'Piper VITS Hindi (pratham-medium) — Hindi TTS',
    //     url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-hi_IN-pratham-medium.tar.bz2',
    //     extractTo: path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'models', 'piper-hi'),
    //     type: 'archive',
    // },
];

// ─── Helpers ────────────────────────────────────────────────────────

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`  📁 Created: ${dirPath}`);
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const follow = (currentUrl, redirectCount = 0) => {
            if (redirectCount > 10) {
                reject(new Error('Too many redirects'));
                return;
            }

            const protocol = currentUrl.startsWith('https') ? https : http;
            protocol.get(currentUrl, (response) => {
                // Follow redirects (GitHub releases use 302). Hugging Face sends
                // small files with a relative Location: resolve it against this URL.
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    response.resume();
                    follow(new URL(response.headers.location, currentUrl).toString(), redirectCount + 1);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode} for ${currentUrl}`));
                    return;
                }

                const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
                let downloadedBytes = 0;
                const file = fs.createWriteStream(dest);

                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                        process.stdout.write(`\r  ⬇️  ${pct}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
                    }
                });

                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(''); // newline after progress
                    resolve();
                });
                file.on('error', (err) => {
                    fs.unlink(dest, () => {}); // cleanup partial file
                    reject(err);
                });
            }).on('error', reject);
        };

        follow(url);
    });
}

function extractArchive(archivePath, extractTo) {
    ensureDir(extractTo);

    // Use tar to extract .tar.bz2
    try {
        execSync(`tar -xjf "${archivePath}" -C "${extractTo}" --strip-components=1`, {
            stdio: 'pipe',
        });
    } catch (err) {
        // Try without --strip-components if it fails (some archives have no top-level dir)
        try {
            execSync(`tar -xjf "${archivePath}" -C "${extractTo}"`, {
                stdio: 'pipe',
            });
        } catch (err2) {
            throw new Error(`Failed to extract ${archivePath}: ${err2.message}`);
        }
    }
}

/**
 * The pieces of a SentencePiece model (`bpe.model`, a protobuf ModelProto) as
 * [piece, score] pairs, in id order. ModelProto field 1 is the repeated
 * SentencePiece message: 1 = piece (string), 2 = score (float), 3 = type.
 */
function sentencePieces(buf) {
    let pos = 0;
    // Protobuf varints and tags, in plain arithmetic (7 bits per byte; tag = field * 8 + wire type).
    const varint = () => {
        let value = 0;
        let scale = 1;
        let byte;
        do {
            if (pos >= buf.length) throw new Error('bpe.model ends inside a number');
            byte = buf[pos++];
            value += (byte % 128) * scale;
            scale *= 128;
        } while (byte >= 128);
        return value;
    };
    const skip = (wire) => {
        if (wire === 0) varint();
        else if (wire === 1) pos += 8;
        else if (wire === 2) {
            // Read the length first: `pos += varint()` would add it to pos as it was before.
            const length = varint();
            pos += length;
        }
        else if (wire === 5) pos += 4;
        else throw new Error(`bpe.model: unsupported protobuf wire type ${wire}`);
    };
    const pieces = [];
    while (pos < buf.length) {
        const tag = varint();
        if (Math.floor(tag / 8) !== 1 || tag % 8 !== 2) {
            skip(tag % 8);
            continue;
        }
        const length = varint();
        const end = pos + length;
        let piece = null;
        let score = 0;
        while (pos < end) {
            const t = varint();
            const fieldNo = Math.floor(t / 8);
            const wire = t % 8;
            if (fieldNo === 1 && wire === 2) {
                const n = varint();
                piece = buf.toString('utf8', pos, pos + n);
                pos += n;
            } else if (fieldNo === 2 && wire === 5) {
                score = buf.readFloatLE(pos);
                pos += 4;
            } else {
                skip(wire);
            }
        }
        pos = end;
        if (piece !== null) pieces.push([piece, score]);
    }
    return pieces;
}

/**
 * The bpe.vocab text sherpa-onnx reads to turn hotwords into the model's
 * tokens: one "piece score" line per piece, in id order. sherpa-onnx exits
 * the app on a line that isn't exactly that, so this refuses anything that
 * would make one.
 *
 * The scores are not the model's own. sherpa-onnx splits a hotword by the
 * highest total score, while this model's BPE splits words by merge order.
 * "Fewest pieces, then the earliest merges" (score = -(pieces + id)) splits
 * 79.5% of 26,604 common Hindi words exactly as the model does (88.9% of the
 * top 2,000), against 75.0% (80.1%) with the exported scores; a hotword only
 * helps when its pieces are the ones the model emits.
 * research/experiments/hotword-split.exp.py measures it.
 */
function bpeVocabText(buf) {
    const pieces = sentencePieces(buf);
    if (pieces.length === 0) throw new Error('bpe.model has no pieces');
    return pieces.map(([piece, score], id) => {
        if (!piece || /\s/.test(piece) || !Number.isFinite(score)) {
            throw new Error(`bpe.model has a piece sherpa-onnx can't read: ${JSON.stringify(piece)} ${score}`);
        }
        return `${piece} ${-(pieces.length + id)}`;
    }).join('\n') + '\n';
}

/** SHA-256 of a file, as hex. */
function sha256Of(file) {
    return require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Downloads `url` to `dest` and checks its SHA-256; a wrong file is deleted, never kept. */
async function downloadChecked(url, dest, sha256) {
    await downloadFile(url, dest);
    const got = sha256Of(dest);
    if (got !== sha256) {
        fs.rmSync(dest, { force: true });
        throw new Error(`${path.basename(dest)} is not the expected file (SHA-256 ${got}, expected ${sha256})`);
    }
}

/** The Hindi speech model: the four model files, bpe.vocab made from bpe.model, and the CC BY notice. */
async function prepareHindiModel(dir = HINDI_DIR) {
    ensureDir(dir);
    for (const file of HINDI_DOWNLOADS) {
        const dest = path.join(dir, file.name);
        if (fs.existsSync(dest) && sha256Of(dest) === file.sha256) continue;
        console.log(`  Downloading ${file.name}`);
        await downloadChecked(file.url, dest, file.sha256);
    }
    if (!hasAllFiles(dir, ['bpe.vocab'])) {
        const bpeModel = path.join(dir, 'bpe.model');
        console.log('  Making bpe.vocab from bpe.model');
        await downloadChecked(HINDI_BPE_MODEL.url, bpeModel, HINDI_BPE_MODEL.sha256);
        fs.writeFileSync(path.join(dir, 'bpe.vocab'), bpeVocabText(fs.readFileSync(bpeModel)));
    }
    fs.writeFileSync(path.join(dir, 'NOTICE.txt'), HINDI_NOTICE);
    const { removed, bytes } = pruneToKeepList(dir, HINDI_KEEP);
    if (removed.length > 0) console.log(`  🧹 Removed ${removed.join(', ')} (${(bytes / 1024).toFixed(0)} KB)`);
}

/**
 * Deletes sherpa-onnx AARs of any other version from `libsDir`. Gradle links
 * every sherpa AAR it finds there, and two versions mean duplicate classes.
 * Returns the names it removed.
 */
function removeOtherSherpaAars(libsDir, keepName) {
    if (!fs.existsSync(libsDir)) return [];
    const stale = fs.readdirSync(libsDir)
        .filter((f) => /^sherpa-onnx-.*\.aar$/.test(f) && f !== keepName);
    stale.forEach((f) => fs.unlinkSync(path.join(libsDir, f)));
    return stale;
}

/** True when every file in `keep` is in `dir` and not empty. */
function hasAllFiles(dir, keep) {
    return keep.every((name) => {
        try {
            return fs.statSync(path.join(dir, name)).size > 0;
        } catch {
            return false;
        }
    });
}

/**
 * Deletes everything in `dir` that is not in `keep` (files and folders).
 * Returns the names it removed and the bytes that freed.
 */
function pruneToKeepList(dir, keep) {
    if (!fs.existsSync(dir)) return { removed: [], bytes: 0 };
    const sizeOf = (target) => {
        const stat = fs.statSync(target);
        if (!stat.isDirectory()) return stat.size;
        return fs.readdirSync(target).reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
    };
    const removed = [];
    let bytes = 0;
    for (const name of fs.readdirSync(dir)) {
        if (keep.includes(name)) continue;
        const target = path.join(dir, name);
        bytes += sizeOf(target);
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(name);
    }
    return { removed, bytes };
}

// ─── Main ───────────────────────────────────────────────────────────

/** Removes what the app does not load from an extracted model folder. */
function reportPruned(model) {
    if (!model.keep) return;
    const { removed, bytes } = pruneToKeepList(model.extractTo, model.keep);
    if (removed.length > 0) {
        console.log(`  🧹 Removed ${removed.length} unused item(s), ${(bytes / 1024 / 1024).toFixed(0)} MB that would have gone into the APK`);
    }
}

async function main() {
    console.log('\n🧠 Pinpointer Model Downloader');
    console.log('================================\n');

    for (const model of MODELS) {
        console.log(`📦 ${model.name}`);

        if (model.type === 'hindi') {
            await prepareHindiModel();
            console.log('  ✅ Done\n');
            continue;
        }

        if (model.type === 'file') {
            // Direct file download (e.g., AAR)
            ensureDir(path.dirname(model.dest));
            if (/^sherpa-onnx-.*\.aar$/.test(path.basename(model.dest))) {
                removeOtherSherpaAars(path.dirname(model.dest), path.basename(model.dest))
                    .forEach((f) => console.log(`  🧹 Removed other version: ${f}`));
            }

            if (fs.existsSync(model.dest)) {
                console.log(`  ✅ Already exists: ${path.basename(model.dest)}\n`);
                continue;
            }

            console.log(`  Downloading from: ${model.url}`);
            await downloadFile(model.url, model.dest);
            console.log(`  ✅ Saved: ${path.basename(model.dest)}\n`);

        } else if (model.type === 'archive') {
            // Download archive, extract, then delete archive
            ensureDir(model.extractTo);

            // Already extracted? With a keep list, every listed file must be
            // there (a download that was cut short leaves only some of them).
            const existingFiles = fs.existsSync(model.extractTo)
                ? fs.readdirSync(model.extractTo)
                : [];
            const hasModel = model.keep
                ? hasAllFiles(model.extractTo, model.keep)
                : existingFiles.some(f => f.endsWith('.onnx'));

            if (hasModel) {
                console.log(`  ✅ Already extracted to: ${path.basename(model.extractTo)}`);
                reportPruned(model);
                console.log('');
                continue;
            }

            const archiveName = path.basename(model.url);
            const archivePath = path.join(__dirname, archiveName);

            console.log(`  Downloading from: ${model.url}`);
            await downloadFile(model.url, archivePath);

            console.log(`  📂 Extracting to: ${model.extractTo}`);
            extractArchive(archivePath, model.extractTo);

            // Cleanup archive
            fs.unlinkSync(archivePath);
            if (model.keep && !hasAllFiles(model.extractTo, model.keep)) {
                throw new Error(`${archiveName} did not contain ${model.keep.join(', ')}`);
            }
            reportPruned(model);
            console.log(`  ✅ Done\n`);
        }
    }

    console.log('================================');
    console.log('✅ All models ready!\n');
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`\n❌ Model download failed: ${err.message}`);
        console.error('You can retry by running: node download-models.js\n');
        process.exit(1);
    });
}

module.exports = {
    SHERPA_ONNX_VERSION, WHISPER_FILES, HINDI_FILES, HINDI_DOWNLOADS, HINDI_REVISION,
    removeOtherSherpaAars, hasAllFiles, pruneToKeepList, sentencePieces, bpeVocabText, sha256Of, prepareHindiModel,
};
