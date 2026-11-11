/**
 * Two native libraries share one libonnxruntime.so inside the APK:
 * sherpa-onnx (voice search) and onnxruntime-android (CLIP photo search).
 * Each asks for ONNX Runtime by its exact version tag, so a mismatch does not
 * fail the build: one of the two simply cannot load on the phone.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SHERPA_ONNX_VERSION, removeOtherSherpaAars } = require('../download-models');

const gradle = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'build.gradle'), 'utf8');

/**
 * sherpa-onnx release -> the ONNX Runtime it is built against
 * (`onnxruntime_version` in its build-android-arm64-v8a.sh). Add a line here
 * when you upgrade, after checking the new pair on a phone.
 */
const ONNX_RUNTIME_FOR_SHERPA = {
  '1.13.4': '1.27.0',
};

describe('native libraries that share libonnxruntime.so', () => {
  it('uses the onnxruntime-android that matches the sherpa-onnx AAR', () => {
    const expected = ONNX_RUNTIME_FOR_SHERPA[SHERPA_ONNX_VERSION];
    expect(expected).toBeDefined();
    const match = /com\.microsoft\.onnxruntime:onnxruntime-android:([\d.]+)/.exec(gradle);
    expect(match && match[1]).toBe(expected);
  });

  it('links the sherpa-onnx AAR without its own libonnxruntime.so', () => {
    expect(gradle).toMatch(/exclude\s+'jni\/\*\/libonnxruntime\.so'/);
    // Linking every AAR in libs/ would bring the second copy back.
    expect(gradle).not.toMatch(/implementation\s+fileTree\(dir:\s*'libs'/);
  });

  it('leaves out the sherpa-onnx API libraries the app never loads', () => {
    expect(gradle).toMatch(/exclude\s+'jni\/\*\/libsherpa-onnx-c-api\.so'/);
    expect(gradle).toMatch(/exclude\s+'jni\/\*\/libsherpa-onnx-cxx-api\.so'/);
    // The one the Kotlin classes load must stay.
    expect(gradle).not.toMatch(/exclude\s+'jni\/\*\/libsherpa-onnx-jni\.so'/);
  });

  it('does not let Gradle pick one of two libonnxruntime.so copies', () => {
    const pickFirsts = /pickFirsts\s*=\s*\[([\s\S]*?)\]/.exec(gradle);
    expect(pickFirsts).not.toBeNull();
    expect(pickFirsts[1]).not.toContain('libonnxruntime.so');
  });
});

describe('removeOtherSherpaAars', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpointer-libs-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the wanted version and removes the others', () => {
    for (const name of ['sherpa-onnx-1.13.4.aar', 'sherpa-onnx-1.13.6.aar', 'sherpa-onnx-1.12.0.aar', 'other.aar', 'notes.txt']) {
      fs.writeFileSync(path.join(dir, name), '');
    }
    expect(removeOtherSherpaAars(dir, 'sherpa-onnx-1.13.4.aar').sort()).toEqual([
      'sherpa-onnx-1.12.0.aar',
      'sherpa-onnx-1.13.6.aar',
    ]);
    expect(fs.readdirSync(dir).sort()).toEqual(['notes.txt', 'other.aar', 'sherpa-onnx-1.13.4.aar']);
  });

  it('does nothing when the folder is missing', () => {
    expect(removeOtherSherpaAars(path.join(dir, 'nope'), 'sherpa-onnx-1.13.4.aar')).toEqual([]);
  });
});
