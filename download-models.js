/**
 * download-models.js — Build-time script to download sherpa-onnx models, AAR, and MobileCLIP2-S0 ONNX models.
 * 
 * Downloads:
 *   1. Whisper Base (English, INT8 quantized) for STT (~165 MB)
 *   2. MobileCLIP2-S0 Vision Encoder (INT8) for semantic search (~11 MB)
 *   3. MobileCLIP2-S0 Text Encoder (INT8) for semantic search (~32 MB)
 *   4. OpenCLIP BPE Vocabulary for text tokenization (~1.3 MB)
 *   5. sherpa-onnx Android AAR
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
                // Follow redirects (GitHub releases use 302)
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    follow(response.headers.location, redirectCount + 1);
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

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
    console.log('\n🧠 Pinpointer Model Downloader');
    console.log('================================\n');

    for (const model of MODELS) {
        console.log(`📦 ${model.name}`);

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

            // Check if already extracted (look for any .onnx file)
            const existingFiles = fs.existsSync(model.extractTo)
                ? fs.readdirSync(model.extractTo)
                : [];
            const hasModel = existingFiles.some(f => f.endsWith('.onnx'));

            if (hasModel) {
                console.log(`  ✅ Already extracted to: ${path.basename(model.extractTo)}\n`);
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

module.exports = { SHERPA_ONNX_VERSION, removeOtherSherpaAars };
