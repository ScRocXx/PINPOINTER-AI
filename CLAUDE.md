# CLAUDE.md

Guidance for Claude Code (and any AI assistant) working in this repository. Keep this file current: update it in the same commit as any change to architecture, commands or rules.

## Project

**PinPointer** is a privacy-first, fully offline Android app that finds photos, screenshots and PDFs by the text in them and by what they show. It's built with React Native 0.83.1 and TypeScript, plus Kotlin/Java native modules. Android is the only target; `ios/` is unused starter scaffolding. All ML runs on the device and there are no cloud calls.

**Users:** elderly and non-technical people on **low-end Android phones** (2–3 GB RAM, slow CPU, small storage), with Hindi and Indian languages as a focus. Before adding anything, check its cost in RAM, battery, APK size and CPU. Prefer no new dependencies, and keep the UI simple and in plain words.

Phase 1 covers photos and PDFs. Phase 2 (later) is video search for creators.

## Commands

```bash
npm install                 # postinstall runs download-models.js (sherpa AAR + Whisper STT)
npm start                   # Metro
npm run android             # build + install (needs Android SDK, a device or emulator)
npx tsc --noEmit            # type check (must be clean)
npm run lint                # eslint (must be clean)
npx jest                    # 38 suites / ~1110 tests (must all pass). Slow on the D: drive; use --silent (--runInBand if workers run out of memory)
cd android && ./gradlew assembleDebug    # native compile check
adb shell cmd jobscheduler run -f ai.runanywhere.starter 4711   # force the charging-time indexing job
```

- CLIP models (`android/app/src/main/assets/models/clip/vision_encoder_int8.onnx`, `text_encoder_int8.onnx`, vocab) are gitignored and made with `scripts/export_mobileclip.py`. Without them semantic search is off, and the app falls back to text search.
- `fix_aar.py` (untracked) strips `libonnxruntime.so` from the sherpa-onnx AAR so it doesn't clash with `onnxruntime-android` 1.20.0 (`pickFirst`). If STT or CLIP crashes at load, check this first.
- Done means: tsc clean, lint clean, all Jest tests pass, and for native changes, `assembleDebug` builds.

## Architecture

**Data flow:** gallery/PDFs → `IndexingService` queue → pipelines (Vision/Document) → enrichment (Indic transliteration, sound keys, concepts, PII masking, classifier) → op-sqlite (FTS5 + sqlite-vec) → hybrid search.

### Database: `src/database/`
- `connection.ts`: singleton op-sqlite DB `pinpoint.db` (WAL). **`MIGRATIONS[]`** is versioned with `PRAGMA user_version`, one transaction each. Migration 1 adds the `files` table and seeds it from the existing index. Migration 2 adds Indian-language search keys and the FTS5 tokenizer, and re-masks old rows.
- `documents.ts`: `indexDocument` (masks PII, writes search keys, deletes the old vector), `isFileIndexed`, `clearIndex` (also clears `vec_index`).
- `fileState.ts`: the **`files` table**, with per-file, per-stage state: `ocr` and `embed` status (`pending|done|failed|skipped`), embed model (`CURRENT_EMBED_MODEL = 'mobileclip2-s0'`), attempts (`MAX_ATTEMPTS = 3`), last error and mtime. Call `noteFileSeen(uri, kind, mtime)` to get the stages a file still needs.
- `vectors.ts`: sqlite-vec `vec_index` (float32[512]) plus `getImagesMissingEmbeddings` for the backfill.
- `search.ts`: hybrid search (RRF, FTS weighted 2×) with a vector cutoff **`MAX_VECTOR_DISTANCE = 1.26`** (to be tuned on a phone), falling back to FTS-only, then LIKE + synonyms + Soundex. Indian-language queries are matched through the sound and concept keys.

### Indexing: one queue
- `src/services/IndexingService.ts` is **the only place indexing runs**: one queue, one job at a time. Jobs: `gallery-quick`, `gallery-quick-background`, `gallery-deep`, `documents`, `backfill`, `prune`. User-started jobs go before background ones, and the backfill yields. Calling sync twice reuses the running job.
- `src/utils/GallerySync.ts`: gallery loops (quick, deep with a saved cursor, embedding backfill).
- `src/utils/DocumentSync.ts`: PDF crawl (Download/, Documents/, plus copies of picked or shared PDFs from `PdfImport`). Newest first; a `limit` counts only PDFs that still need work.
- `src/utils/MissingFiles.ts`: removes deleted photos and PDFs from the index (`removeDocument`). `pruneMissingFiles` is the `prune` job; `forgetIfGone` runs when a result is tapped. A file only counts as gone when we may look (full photo access, All Files Access, or our own imported copy) and `RNFS.stat` says it doesn't exist.
- `src/services/BackgroundIndexingTask.ts` + native `IndexingJobService.kt` / `IndexingSchedulerModule.kt`: a JobScheduler job (**id 4711**, every 6 h with 2 h flex, only while charging with battery and storage not low, persisted). It runs a headless JS task that resumes deep sync, then the prune, then the backfill, stops after 8 min or on unplug, never asks for permissions, and counts limited photo access.
- `src/utils/VisionPipeline.ts`: resize → ML Kit OCR (Latin + Devanagari) → garbage filter → labels as a fallback → CLIP image embedding (`EmbeddingService` → `MobileCLIPModule`).
- `src/utils/DocumentPipeline.ts`: 5-phase PDF pipeline (native text for digital PDFs, raster + OCR for scanned ones; 500 chars/page, 2000 total, pages 1–3).

### Search and language
- `src/hooks/useSearch.ts`: FTS results show **immediately**, then get re-ranked when the CLIP query vector arrives. No duplicate search for history. Hindi words reach CLIP as English through `ConceptTable`, and unknown non-Latin text skips CLIP.
- `src/utils/IndicText.ts`: one converter from 10 Indian scripts to Roman (schwa deletion, conjuncts, Indic digits) plus the **Bhasha sound key**.
- `src/utils/SearchKeys.ts`: builds the same sound and concept keys for documents and queries.
- `src/utils/ConceptTable.ts`: about 50 Hindi/Hinglish/English concepts with meaning IDs.
- `src/utils/HindiTranslit.ts`, `TextEnrichment.ts`, `Soundex.ts`, `DocumentClassifier.ts`: enrichment, classification and smart titles (titles are masked).
- `src/utils/DataMasking.ts`: Aadhaar, PAN and phone, including Indic digits. **Masking happens at index time. Never store unmasked content or titles.**

### Permissions and import
- `src/utils/StoragePermissions.ts`: photo access (`full|limited|denied|blocked`, including Android 14+ `READ_MEDIA_VISUAL_USER_SELECTED`), a plain-language Settings guide, re-checks on return to the app, and a real All Files Access check (`StorageModule.isExternalStorageManager`).
- `src/utils/PdfImport.ts` + `DocumentAccessModule.kt`: SAF folder picker with lasting access, plus "Share / Open with Pinpointer" (MainActivity intents). PDFs are copied into app storage.
- Manifest: `MANAGE_EXTERNAL_STORAGE` (needs a Play declaration, "on-device file search"), `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED`, legacy storage capped at `maxSdkVersion 32`, `RECEIVE_BOOT_COMPLETED`.

### State and UI
- `src/hooks/PinpointerContext.tsx` provides one `usePinpointer()`. **Screens must use `usePinpointerShared()`.** A second instance means duplicate sync engines and listeners.
- Hooks (`useGallerySync`, `useDocumentSync`) only handle permissions, alerts and progress. They call `IndexingService` and must never run sync loops themselves.
- Screens: `PinpointerScreen` (home/search), `HomeScreen` (drawer), `gallery`, `DocumentVaultScreen`, `SmartClipboardScreen`. Point & Speak and Speech-to-Text were removed.
- Voice: sherpa-onnx Whisper base.en STT (`SherpaOnnxModule`, `useVoiceRecording`). TTS is off.
- Entry: `src/App.tsx` (GestureHandlerRootView → ModelServiceProvider → PinpointerProvider; `setupDatabase()` and `scheduleBackgroundIndexing()` on mount). `index.js` also registers the headless task.

### Native modules (`android/app/src/main/java/ai/runanywhere/starter/`)
`MobileCLIPModule` (own thread, int8 models, ORT 1.20; decodes file paths and the `content://` URIs gallery photos use) + `BPETokenizer` (CLIP-exact vocab), `NativePdfModule`, `SherpaOnnxModule`, `StorageModule`, `DocumentAccessModule`, `IndexingJobService` + `IndexingSchedulerModule`. The package name is still `ai.runanywhere.starter` (rebrand pending).

## Rules

- Schema change → append a new entry to `MIGRATIONS`. Never edit an old one.
- Indexing → only through `IndexingService`. Record per-file progress in `files` (`fileState.ts`).
- PII → mask before storing (content **and** title). Search history is still unmasked in AsyncStorage (known gap).
- Logging → `AppLogger`, not `console.log`.
- Imports are relative (no path aliases).
- Tests live in `__tests__/` next to the code. Native modules are mocked in `jest.setup.js` and `__mocks__/`. Add or adjust tests with every change.
- Don't commit: model files, `.claude/settings.local.json`, crash logs, `graphify-out/` (gitignored, regenerate with `graphify update .`).
- One branch per task (`feat/…`, `fix/…`, `chore/…`). Small commits. Don't push or merge without the owner's OK.
