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

1. Connect the owner's computer (Claude desktop app, Remote Control, this
   repo on `smart-main`). Phone on USB with debugging allowed. Then
   `node tools/search-bench/device/bench.js check`.
2. Make sure the CLIP models are in
   `android/app/src/main/assets/models/clip/`. If not, ask the owner where
   they are, or make them with `scripts/export_mobileclip.py`.
3. `device/bench.js build`, then `install`. A Xiaomi/Redmi/POCO phone also
   needs "Install via USB" and "USB debugging (Security settings)".
4. **Real gallery first:**
   - `grant`, then `index`; this also writes `privacy.json` (shapes of numbers
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
