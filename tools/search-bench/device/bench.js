#!/usr/bin/env node
/* eslint-env node */
/**
 * The phone bench, end to end, over USB (adb). Works on Windows, macOS and Linux.
 *
 *   node device/bench.js prepare           make the gallery: searches, COCO photos (1 GB download), images, PDFs
 *   node device/bench.js check             phone, Android version, RAM, storage, the app
 *   node device/bench.js build             a bench APK (release, BENCH_BUILD on just for this build)
 *   node device/bench.js install           install it (-r keeps the app's data)
 *   node device/bench.js push              copy the test photos and PDFs to the phone
 *   node device/bench.js grant             photo access + All files access, without taps
 *   node device/bench.js index             open the app, index everything, watch memory and heat
 *   node device/bench.js search            run every search on the phone, pull and score the results
 *   node device/bench.js all               check → push → grant → index → search
 *   node device/bench.js clean             take the test files off the phone (--reset-app also clears the app)
 *
 * Options: --serial ID (several devices), --out DIR (default tools/search-bench/out),
 * --set NAME (search: run out/device/NAME/queries.jsonl instead, e.g. your real gallery's), --apk FILE, --k 100 (nearest photos recorded per search, with distances).
 *
 * "prepare" runs corpus/generate.js, the COCO download ("coco"), device/photos.js and device/render.js.
 * The phone talks back through files in Android/data/com.pinpointer.app/files/bench (see
 * src/bench/BenchRunner.ts). Only a bench build listens.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const flag = name => process.argv.includes(`--${name}`);
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'out')));
const DEV = path.join(OUT, 'device');
const MEDIA = path.join(DEV, 'media');
const REPO = path.resolve(__dirname, '..', '..', '..');
const PKG = 'com.pinpointer.app';
const PHONE_BENCH = `/sdcard/Android/data/${PKG}/files/bench`;
const PHONE_PICTURES = '/sdcard/Pictures/PinpointerBench';
const PHONE_DOWNLOAD = '/sdcard/Download/PinpointerBench';
const ADB = process.env.ADB || 'adb';
const SERIAL = arg('serial', null);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = msg => console.log(`[bench] ${msg}`);

const adb = (args, { allowFail = false, quiet = false } = {}) => {
  const full = [...(SERIAL ? ['-s', SERIAL] : []), ...args];
  const r = spawnSync(ADB, full, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`Could not run adb (${r.error.message}). Install Android platform-tools and put adb on PATH, or set ADB=...`);
  if (r.status !== 0 && !allowFail) throw new Error(`adb ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  if (!quiet && r.status !== 0) say(`(adb ${args[0]} said: ${(r.stderr || r.stdout).trim()})`);
  return (r.stdout || '').trim();
};
const sh = (cmd, opts) => adb(['shell', cmd], opts);
const sdk = () => Number(sh('getprop ro.build.version.sdk'));

/** Reads a small file from the app's bench folder, or null. */
const readPhone = name => {
  const out = adb(['shell', `cat ${PHONE_BENCH}/${name} 2>/dev/null`], { allowFail: true, quiet: true });
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
};
const pushJson = (name, data) => {
  const tmp = path.join(os.tmpdir(), `pinpointer-bench-${process.pid}-${name}`);
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data));
  adb(['push', tmp, `${PHONE_BENCH}/${name}`], { quiet: true });
  fs.unlinkSync(tmp);
};
const request = cmd => pushJson('request.json', cmd);

// ─── Steps ──────────────────────────────────────────────────────────────────

const check = () => {
  const devices = adb(['devices']).split('\n').slice(1).filter(l => /\tdevice$/.test(l));
  if (devices.length === 0) throw new Error('No phone found. Plug it in, turn on USB debugging, and tap "Allow" on the phone.');
  if (devices.length > 1 && !SERIAL) throw new Error(`Several devices: ${devices.map(d => d.split('\t')[0]).join(', ')}. Pick one with --serial.`);
  const mem = sh('cat /proc/meminfo').match(/MemTotal:\s+(\d+)/);
  const info = {
    model: `${sh('getprop ro.product.manufacturer')} ${sh('getprop ro.product.model')}`,
    android: sh('getprop ro.build.version.release'),
    sdk: sdk(),
    abi: sh('getprop ro.product.cpu.abi'),
    ramGb: mem ? Math.round((Number(mem[1]) / 1024 / 1024) * 10) / 10 : null,
    cores: Number(sh('nproc', { allowFail: true }) || 0) || null,
    freeStorage: sh('df -h /sdcard | tail -1', { allowFail: true }),
    emulator: sh('getprop ro.kernel.qemu') === '1',
    app: sh(`pm list packages ${PKG}`, { allowFail: true }).includes(PKG) ? sh(`dumpsys package ${PKG} | grep versionName`, { allowFail: true }).trim() : 'not installed',
  };
  fs.mkdirSync(DEV, { recursive: true });
  fs.writeFileSync(path.join(DEV, 'device.json'), JSON.stringify(info, null, 2));
  say(`${info.model}, Android ${info.android} (SDK ${info.sdk}), ${info.ramGb} GB RAM, ${info.abi}${info.emulator ? ', emulator' : ''}`);
  say(`storage: ${info.freeStorage}`);
  say(`app: ${info.app}`);
  if (info.ramGb && info.ramGb > 4) say('note: this phone has more RAM than most of Pinpointer\'s users (2-3 GB); speed and memory will look better than theirs.');
  return info;
};

const build = () => {
  const flagFile = path.join(REPO, 'src', 'bench', 'benchFlag.ts');
  const original = fs.readFileSync(flagFile, 'utf8');
  const clip = path.join(REPO, 'android', 'app', 'src', 'main', 'assets', 'models', 'clip', 'text_encoder_int8.onnx');
  if (!fs.existsSync(clip)) say('WARNING: the CLIP models are not in android/app/src/main/assets/models/clip: photo search will be off in this build (scripts/export_mobileclip.py makes them).');
  let abis = 'arm64-v8a,armeabi-v7a';
  try {
    if (sh('getprop ro.kernel.qemu', { allowFail: true, quiet: true }) === '1') abis += ',x86_64';
  } catch {
    // no phone attached: build for phones
  }
  fs.writeFileSync(flagFile, original.replace('BENCH_BUILD = false', 'BENCH_BUILD = true'));
  try {
    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    say(`building a bench APK (${abis})…`);
    const r = spawnSync(gradlew, ['assembleRelease', `-PpinpointerAbis=${abis}`], { cwd: path.join(REPO, 'android'), stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error('The Android build failed (see above).');
  } finally {
    fs.writeFileSync(flagFile, original);
  }
  say(`built: ${path.join(REPO, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')}`);
};

const install = () => {
  const apk = path.resolve(arg('apk', path.join(REPO, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')));
  if (!fs.existsSync(apk)) throw new Error(`No APK at ${apk}. Run "node device/bench.js build" first, or pass --apk.`);
  say(`installing ${path.basename(apk)}…`);
  adb(['install', '-r', apk]);
};

const push = () => {
  for (const dir of ['Pictures', 'Download']) {
    if (!fs.existsSync(path.join(MEDIA, dir))) throw new Error(`Nothing to push: ${path.join(MEDIA, dir)} is missing. Run device/render.js first.`);
  }
  const pictures = fs.readdirSync(path.join(MEDIA, 'Pictures')).filter(f => f.endsWith('.jpg'));
  const pdfs = fs.readdirSync(path.join(MEDIA, 'Download')).filter(f => f.endsWith('.pdf'));
  say(`copying ${pictures.length} photos and ${pdfs.length} PDFs (this takes a few minutes)…`);
  sh(`mkdir -p ${PHONE_PICTURES} ${PHONE_DOWNLOAD}`);
  adb(['push', '--sync', path.join(MEDIA, 'Pictures') + '/.', PHONE_PICTURES]);
  adb(['push', '--sync', path.join(MEDIA, 'Download') + '/.', PHONE_DOWNLOAD]);
  // Make sure the gallery (MediaStore) lists them.
  const counted = () => {
    const out = sh(`content query --uri content://media/external/images/media --projection _id --where "_data LIKE '%/Pictures/PinpointerBench/%'"`, { allowFail: true, quiet: true });
    return out.split('\n').filter(l => l.startsWith('Row:')).length;
  };
  let n = counted();
  if (n < pictures.length) {
    say(`the gallery lists ${n} of ${pictures.length}; asking Android to scan the folder…`);
    sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${PHONE_PICTURES}`, { allowFail: true, quiet: true });
    for (const f of pictures) {
      if (n >= pictures.length) break;
      sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${PHONE_PICTURES}/${f}`, { allowFail: true, quiet: true });
    }
    n = counted();
  }
  say(`the gallery lists ${n} of ${pictures.length} test photos`);
  const present = [...pictures, ...pdfs].map(f => f.replace(/\.(jpg|pdf)$/, ''));
  fs.writeFileSync(path.join(DEV, 'present.json'), JSON.stringify(present));
};

const grant = () => {
  const level = sdk();
  const perms = level >= 33 ? ['android.permission.READ_MEDIA_IMAGES'] : ['android.permission.READ_EXTERNAL_STORAGE'];
  for (const p of perms) sh(`pm grant ${PKG} ${p}`, { allowFail: true });
  if (level >= 30) sh(`appops set --uid ${PKG} MANAGE_EXTERNAL_STORAGE allow`, { allowFail: true });
  say(`granted photo access${level >= 30 ? ' and All files access' : ''}`);
};

const launch = async () => {
  sh('svc power stayon usb', { allowFail: true, quiet: true });
  sh('input keyevent KEYCODE_WAKEUP', { allowFail: true, quiet: true });
  sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`, { allowFail: true, quiet: true });
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    if (readPhone('status.json')) return;
  }
  throw new Error('The app did not answer. Is this a bench build (node device/bench.js build)? Is the app open on the phone?');
};

/** Memory and temperature now (for low-end phones these matter as much as accuracy). */
const sample = () => {
  const mem = sh(`dumpsys meminfo ${PKG}`, { allowFail: true, quiet: true }).match(/TOTAL(?: PSS)?:?\s+(\d+)/);
  const temp = sh('dumpsys battery', { allowFail: true, quiet: true }).match(/temperature: (\d+)/);
  const level = sh('dumpsys battery', { allowFail: true, quiet: true }).match(/level: (\d+)/);
  return { at: Date.now(), pssMb: mem ? Math.round(Number(mem[1]) / 1024) : null, batteryC: temp ? Number(temp[1]) / 10 : null, batteryPct: level ? Number(level[1]) : null };
};

const watch = async (doneFile, label, every = 20000) => {
  const log = path.join(DEV, `${label}-monitor.jsonl`);
  fs.writeFileSync(log, '');
  const t0 = Date.now();
  for (;;) {
    const done = readPhone(doneFile);
    const status = readPhone('status.json');
    const s = { ...sample(), status };
    fs.appendFileSync(log, JSON.stringify(s) + '\n');
    const r = status?.ready;
    const progress = status?.searched != null ? `${status.searched} of ${status.of} searches` : r ? `photos ${JSON.stringify(r.photos ?? r)} · PDFs ${JSON.stringify(r.pdfs ?? '')} · vectors ${status.vectors}` : 'starting';
    process.stdout.write(`\r[bench] ${label}: ${Math.round((Date.now() - t0) / 60000)} min · ${progress} · ${s.pssMb ?? '?'} MB · ${s.batteryC ?? '?'}°C          `);
    if (done) {
      process.stdout.write('\n');
      return done;
    }
    const err = readPhone('error.json');
    if (err && err.at > t0) throw new Error(`The app reported: ${err.error}`);
    await sleep(every);
  }
};

const index = async () => {
  await launch();
  sh(`rm -f ${PHONE_BENCH}/index-done.json`, { allowFail: true, quiet: true });
  request({ cmd: 'index' });
  say('indexing on the phone (keep it plugged in and the screen on; an hour or more for 10,000 photos on a slow phone)…');
  const done = await watch('index-done.json', 'index', 30000);
  fs.writeFileSync(path.join(DEV, 'index-done.json'), JSON.stringify(done, null, 2));
  say(`indexed in ${Math.round(done.ms.total / 60000)} min: ${JSON.stringify(done.ready)}`);
};

const search = async () => {
  // --set NAME: another list of searches (out/device/NAME/queries.jsonl), e.g. your real gallery's.
  const QDIR = arg('set') ? path.join(DEV, arg('set')) : DEV;
  const queries = path.join(QDIR, 'queries.jsonl');
  if (!fs.existsSync(queries)) throw new Error('No device searches yet: run "node device/photos.js --coco DIR" first.');
  await launch();
  sh(`rm -f ${PHONE_BENCH}/search-done.json ${PHONE_BENCH}/results.jsonl`, { allowFail: true, quiet: true });
  // The phone only needs each search's id and text.
  const lines = fs.readFileSync(queries, 'utf8').split('\n').filter(Boolean).map(l => {
    const q = JSON.parse(l);
    return JSON.stringify({ qid: q.qid, text: q.text });
  });
  pushJson('queries.jsonl', lines.join('\n') + '\n');
  request({ cmd: 'search', k: Number(arg('k', 100)) });
  say(`running ${lines.length} searches on the phone…`);
  await watch('search-done.json', 'search', 5000);
  adb(['pull', `${PHONE_BENCH}/results.jsonl`, path.join(QDIR, 'results.jsonl')], { quiet: true });
  const run = readPhone('run.json');
  const device = fs.existsSync(path.join(DEV, 'device.json')) ? JSON.parse(fs.readFileSync(path.join(DEV, 'device.json'), 'utf8')) : null;
  fs.writeFileSync(path.join(QDIR, 'run.json'), JSON.stringify({ ...run, device }, null, 2));
  say('scoring…');
  spawnSync(process.execPath, [path.join(__dirname, '..', 'score.js'), path.join(QDIR, 'results.jsonl')], { stdio: 'inherit' });
  spawnSync(process.execPath, [path.join(__dirname, '..', 'score.js'), path.join(QDIR, 'results.jsonl'), '--phase', 'words'], { stdio: 'inherit' });
};

const clean = () => {
  sh(`rm -rf ${PHONE_PICTURES} ${PHONE_DOWNLOAD} ${PHONE_BENCH}`, { allowFail: true });
  sh('svc power stayon false', { allowFail: true, quiet: true });
  if (flag('reset-app')) sh(`pm clear ${PKG}`, { allowFail: true });
  say(`removed the test files from the phone${flag('reset-app') ? ' and cleared the app' : ''}. Android's gallery forgets them on its next scan.`);
};

/** Downloads COCO val2017 (about 1 GB) into --coco DIR (default out/coco) and unpacks it. */
const coco = async () => {
  const https = require('https');
  const dir = path.resolve(arg('coco', path.join(OUT, 'coco')));
  fs.mkdirSync(dir, { recursive: true });
  const get = (url, file) =>
    new Promise((resolve, reject) => {
      if (fs.existsSync(file)) return resolve();
      say(`downloading ${url}…`);
      const tmp = `${file}.part`;
      https
        .get(url, res => {
          if (res.statusCode !== 200) return reject(new Error(`${url}: HTTP ${res.statusCode}`));
          const total = Number(res.headers['content-length'] || 0);
          let got = 0;
          res.on('data', c => {
            got += c.length;
            if (total) process.stdout.write(`\r[bench] ${Math.round((100 * got) / total)}%   `);
          });
          res.pipe(fs.createWriteStream(tmp)).on('finish', () => {
            fs.renameSync(tmp, file);
            process.stdout.write('\n');
            resolve();
          });
        })
        .on('error', reject);
    });
  const unzip = file => {
    // tar reads zip files on Windows 10+ and macOS; Linux usually has unzip.
    const r = spawnSync('tar', ['-xf', file, '-C', dir], { stdio: 'inherit' });
    if (r.status !== 0) {
      const u = spawnSync('unzip', ['-q', '-o', file, '-d', dir], { stdio: 'inherit' });
      if (u.status !== 0) throw new Error(`Could not unpack ${file}: unpack it into ${dir} by hand.`);
    }
  };
  const val = path.join(dir, 'val2017.zip');
  const ann = path.join(dir, 'annotations_trainval2017.zip');
  await get('https://images.cocodataset.org/zips/val2017.zip', val);
  await get('https://images.cocodataset.org/annotations/annotations_trainval2017.zip', ann);
  if (!fs.existsSync(path.join(dir, 'val2017'))) unzip(val);
  if (!fs.existsSync(path.join(dir, 'annotations', 'instances_val2017.json'))) unzip(ann);
  say(`COCO is ready in ${dir} (photos: CC BY 4.0, cocodataset.org)`);
};

/** Everything before the phone: the gallery, its photos, the files to copy on. */
const prepare = async () => {
  const dir = path.resolve(arg('coco', path.join(OUT, 'coco')));
  const node = (...a) => {
    const r = spawnSync(process.execPath, a, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${path.basename(a[0])} failed`);
  };
  node(path.join(__dirname, '..', 'corpus', 'generate.js'), '--out', OUT, ...(arg('size') ? ['--size', arg('size')] : []));
  await coco();
  node(path.join(__dirname, 'photos.js'), '--out', OUT, '--coco', dir);
  node(path.join(__dirname, 'render.js'), '--out', OUT, '--coco', dir);
};

const STEPS = { check, build, install, push, grant, index, search, clean, coco, prepare };
const OFFLINE = new Set(['build', 'coco', 'prepare']);

const main = async () => {
  const step = process.argv[2];
  if (step === 'all') {
    check();
    push();
    grant();
    await index();
    await search();
    return;
  }
  const fn = STEPS[step];
  if (!fn) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    process.exit(step ? 1 : 0);
  }
  if (!OFFLINE.has(step)) check();
  await fn();
};

main().catch(e => {
  console.error(`\n[bench] ${e.message}`);
  process.exit(1);
});
