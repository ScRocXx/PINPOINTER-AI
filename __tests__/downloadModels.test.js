/**
 * download-models.js decides what goes into the APK's assets: everything
 * left in assets/models/whisper is shipped to every phone.
 */
const { Buffer } = require('buffer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  WHISPER_FILES, HINDI_FILES, HINDI_DOWNLOADS, hasAllFiles, pruneToKeepList, sentencePieces, bpeVocabText, sha256Of,
} = require('../download-models');

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

  it('the Hindi model files are exactly the ones SherpaOnnxModule loads', () => {
    const kotlin = fs.readFileSync(
      path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'pinpointer', 'app', 'SherpaOnnxModule.kt'),
      'utf8',
    );
    const loaded = [...kotlin.matchAll(/"models\/hindi\/([^"]+)"/g)].map((m) => m[1]);
    expect(loaded.sort()).toEqual([...HINDI_FILES].sort());
  });

  it('every Hindi download is pinned to one revision and a SHA-256', () => {
    for (const file of HINDI_DOWNLOADS) {
      expect(file.url).toMatch(/^https:\/\/huggingface\.co\/Henil1\/indic-lekhan\/resolve\/[0-9a-f]{40}\/640ms\//);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

// A tiny SentencePiece ModelProto, written by hand: field 1 = a piece
// {1: text, 2: score (float), 3: type}, field 2 = a trainer spec to skip.
const varint = (n) => {
  const out = [];
  while (n > 127) {
    out.push((n % 128) + 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const field = (num, wire, payload) => [...varint(num * 8 + wire), ...payload];
const withLength = (b) => [...varint(b.length), ...b];
const text = (s) => withLength([...Buffer.from(s, 'utf8')]);
const float = (f) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(f);
  return [...b];
};
const piece = (p, score, type = 1) => field(1, 2, withLength([...field(1, 2, text(p)), ...field(2, 5, float(score)), ...field(3, 0, varint(type))]));
const LONG = '▁' + 'क'.repeat(60); // over 127 bytes: its length takes two bytes
const model = (pieces) => Buffer.from([...field(2, 2, withLength([0x08, 0x02])), ...pieces.flat()]);

describe('sentencePieces', () => {
  it('reads every piece and its score, in order, skipping other fields', () => {
    const buf = model([piece('<unk>', 0, 2), piece('▁क', -1), piece(LONG, -2)]);
    expect(sentencePieces(buf)).toEqual([['<unk>', 0], ['▁क', -1], [LONG, -2]]);
  });

  it('refuses a file that ends half way', () => {
    const buf = model([piece('▁क', -1)]);
    expect(() => sentencePieces(Buffer.concat([buf, Buffer.from([0x0a, 0x80])]))).toThrow();
  });
});

describe('bpeVocabText', () => {
  it('writes "piece score" lines with fewest-pieces-first scores', () => {
    const buf = model([piece('<unk>', 0, 2), piece('▁क', -1), piece('र', -2)]);
    expect(bpeVocabText(buf)).toBe('<unk> -3\n▁क -4\nर -5\n');
  });

  it('refuses a piece sherpa-onnx could not read (it would close the app)', () => {
    expect(() => bpeVocabText(model([piece('a b', -1)]))).toThrow(/can't read/);
    expect(() => bpeVocabText(model([]))).toThrow(/no pieces/);
  });
});

describe('sha256Of', () => {
  it('is the SHA-256 of the file', () => {
    write('a.txt', 3);
    // sha256("xxx")
    expect(sha256Of(path.join(dir, 'a.txt'))).toBe('cd2eb0837c9b4c962c22d2ff8b5441b7b45805887f051d39bf133b583baf6860');
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
