/**
 * download-models.js decides what goes into the APK's assets: everything
 * left in assets/models/whisper is shipped to every phone.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WHISPER_FILES, hasAllFiles, pruneToKeepList } = require('../download-models');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpointer-models-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name, bytes = 4) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), 'x'.repeat(bytes));
};

describe('the speech model files that ship in the APK', () => {
  it('are exactly the ones SherpaOnnxModule loads', () => {
    const kotlin = fs.readFileSync(
      path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'pinpointer', 'app', 'SherpaOnnxModule.kt'),
      'utf8',
    );
    const loaded = [...kotlin.matchAll(/"models\/whisper\/([^"]+)"/g)].map((m) => m[1]);
    expect(loaded.sort()).toEqual([...WHISPER_FILES].sort());
  });
});

describe('pruneToKeepList', () => {
  it('removes the float32 models and sample recordings, keeps the three INT8 files', () => {
    WHISPER_FILES.forEach((name) => write(name, 10));
    write('base.en-encoder.onnx', 100);
    write('base.en-decoder.onnx', 200);
    write('test_wavs/0.wav', 30);
    write('test_wavs/trans.txt', 5);

    const { removed, bytes } = pruneToKeepList(dir, WHISPER_FILES);

    expect(removed.sort()).toEqual(['base.en-decoder.onnx', 'base.en-encoder.onnx', 'test_wavs']);
    expect(bytes).toBe(335);
    expect(fs.readdirSync(dir).sort()).toEqual([...WHISPER_FILES].sort());
  });

  it('does nothing to a folder that is already clean, or missing', () => {
    WHISPER_FILES.forEach((name) => write(name));
    expect(pruneToKeepList(dir, WHISPER_FILES)).toEqual({ removed: [], bytes: 0 });
    expect(pruneToKeepList(path.join(dir, 'nope'), WHISPER_FILES)).toEqual({ removed: [], bytes: 0 });
  });
});

describe('hasAllFiles', () => {
  it('is true only when every file is there and not empty', () => {
    expect(hasAllFiles(dir, WHISPER_FILES)).toBe(false);
    write(WHISPER_FILES[0]);
    write(WHISPER_FILES[1]);
    // A download that stopped half way: one file missing.
    expect(hasAllFiles(dir, WHISPER_FILES)).toBe(false);
    write(WHISPER_FILES[2], 0);
    expect(hasAllFiles(dir, WHISPER_FILES)).toBe(false);
    write(WHISPER_FILES[2]);
    expect(hasAllFiles(dir, WHISPER_FILES)).toBe(true);
  });
});
