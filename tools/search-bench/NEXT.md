# Next: the phone run (handoff)

Start here in a new session. The bench and the desk results are done (README.md,
FINDINGS.md). What's left is running it on the owner's phone.

## What the owner decided

- **Main worry: CLIP adds photos that aren't relevant.** Do CHECKLIST.md
  section N first, on the owner's **real gallery**, then the test gallery.
- **Claude may look at the owner's photos** to judge results
  (`device/sheet.js` → look → `device/judge.js`). Skip photos showing ID
  numbers (Aadhaar, PAN, bank) or other private documents: don't open them,
  and judge them from file names and stored (masked) text instead.
- "Help improve our AI models" is off on the owner's account.
- **Git:** work on `smart-main`; commit freely; **ask before pushing**.
- It is the owner's **personal phone**:
  - copy test files only through `device/bench.js push`;
  - `clean` must remove only bench files (names start with `d` + 5 digits);
  - never `--reset-app` or `pm clear` without asking.
- Users are elderly people on 2–3 GB phones: report speed, memory and heat
  next to accuracy.

## The order

1. **Build in the cloud session** with the environment's `build-apk`
   (setup script). It installs the JDK, SDK and NDK on first use, exports the
   CLIP models into `android/app/src/main/assets/models/clip/` (gitignored),
   and builds arm64 into `/tmp/apk-out`.
   - `build-apk release smart-main`: the normal app. Check the APK holds
     `assets/models/clip/*.onnx` (`unzip -l`).
   - Bench APK: set `BENCH_BUILD = true` in `src/bench/benchFlag.ts`, run
     `build-apk release smart-main` again (it builds the working tree), rename
     the output `PinPointer-bench-…apk`, then `git checkout
     src/bench/benchFlag.ts` and confirm `git status` is clean. Never commit
     the flag on.
   - No debug APK: it needs Metro on a PC to run.
2. **Get the APK to the owner's computer:** send it with SendUserFile (the
   owner downloads it, one click). The cloud can't copy files to the computer
   directly.
3. **Connect the computer:** `list_computer_folders`, then
   `request_computer_folder` for the folder with the repo clone. There:
   `git pull` on `smart-main`, `adb devices` (phone authorised), `node
   tools/search-bench/device/bench.js check`.
   - Install: `bench.js install --apk <downloaded bench APK>`.
   - If a differently signed Pinpointer is already installed, the install
     fails: ask before uninstalling, since that deletes its data.
   - A Xiaomi/Redmi/POCO phone also needs "Install via USB" and "USB
     debugging (Security settings)".
   - Then `bench.js grant`, plus
     `adb shell pm grant com.pinpointer.app android.permission.RECORD_AUDIO`
     (voice checks) and
     `adb shell dumpsys deviceidle whitelist +com.pinpointer.app` (so long
     indexing isn't killed). Undo the last one at the end with
     `whitelist -com.pinpointer.app`.
   - The test gallery (COCO download, drawing images) is prepared **on the
     computer** (`bench.js prepare`; first `npm install` and `npx playwright
     install chromium` in `tools/search-bench`): the cloud network blocks
     COCO, and the images are too big to send.
4. **Real gallery first:**
   - `index`; this also writes `privacy.json` (shapes of numbers
     the mask missed).
   - Write searches for what's in the gallery to
     `out/device/real/queries.jsonl`, `mode: "judge"` (picture searches such
     as people, food, temples, documents, screenshots, festivals; plus
     paper searches).
   - Run `search --set real`, then `sheet.js --set real --worst 30` and the
     picture searches. Look at each sheet, record verdicts with `judge.js`,
     and score again.
   - Pick a `STAND_OUT_GAP` from the sweep table.
5. **Test gallery:** `prepare` (1 GB COCO download), `push`, `index`,
   `search`.
6. The rest of CHECKLIST.md, by section. Results go in
   `out/device/checklist-results.md`, a summary in FINDINGS.md.
7. `clean`.

## Never run on a real phone yet: watch for

- `adb push --sync` with a folder (`dir/.`) on Windows paths.
- `content query … --where "_display_name GLOB 'd[0-9]…'"`: some Android
  versions don't allow GLOB there. Use LIKE 'd%' if it fails.
- `appops set --uid … MANAGE_EXTERNAL_STORAGE allow` (Android 11+).
- The runner's folder `Android/data/com.pinpointer.app/files/bench` exists
  only once a bench build has started.
- `BenchRunner` uses a regex lookbehind (`unmaskedNumberShapes`): check that
  Hermes accepts it in the release build.
- MIUI keeps screenshots in `DCIM/Screenshots`, not `Pictures/Screenshots`
  (checklist H7).
- `bench.js build` flips `src/bench/benchFlag.ts` to true and back. If a
  build is interrupted, check it is `false` before committing.
- The bench talks to the app through `/sdcard/Android/data/com.pinpointer.app/files/bench`.
  `adb shell` can read it on Android 11–14. If a phone refuses
  (`Permission denied`), add a mirror under `/sdcard/Download/PinpointerBench-io`
  to BenchRunner (the app has All files access) rather than giving up.
- APK signing: without the owner's release keystore, `build-apk` signs with
  the repo's `android/app/debug.keystore`. A Pinpointer installed from the
  owner's own PC with the same key installs over it with data kept;
  otherwise ask before uninstalling.
- The new cloud session starts on its own branch: `build-apk … smart-main`
  checks out `smart-main` itself, and commits belong on `smart-main`.
