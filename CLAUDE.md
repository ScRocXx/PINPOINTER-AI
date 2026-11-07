# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PinPointer — privacy-first, offline, on-device search engine for text trapped in screenshots, images, and PDFs. React Native 0.83 (Android-only target; `ios/` is starter scaffolding), TypeScript. No cloud calls: all ML runs on-device.

## Commands

```bash
npm start                  # Metro bundler
npm run android            # build + install on device/emulator
npm test                   # jest (no test files exist yet)
npm run lint               # eslint
npm install                # also runs postinstall: patch-package + download-models.js
node download-models.js    # fetch sherpa-onnx AAR + Whisper STT model into android/app/src/main/assets/models/
```

- Android APK: `cd android && ./gradlew assembleRelease` (or `assembleDebug`).
- `patches/` contains a `patch-package` patch for `react-native-document-picker` — applied on postinstall; don't hand-edit `node_modules`.

## Architecture

**Data flow:** gallery/documents → sync hooks → pipelines (Vision/Document) → enrichment (Soundex, Hindi transliteration, PII masking, classification) → SQLite FTS5 → search.

- `src/Database.ts` — singleton `react-native-quick-sqlite` DB (`pinpoint.db`, WAL mode). FTS5 virtual table with graceful LIKE-based fallback if FTS5 is unavailable. **All PII masking happens at index time, not query time** — masked data is what's stored.
- `src/utils/VisionPipeline.ts` — image pipeline with early-exit: OCR (ML Kit Latin + Devanagari in parallel) → garbage-text filter → object labeling only if OCR finds nothing. Returns `search_index` (original + transliteration + soundex + labels).
- `src/utils/DocumentPipeline.ts` — 5-phase PDF pipeline. Phase 2 early-exits for digital PDFs (native byte-stream text extraction via `NativePdfModule`); only scanned PDFs fall through to rasterization + OCR. Caps: 500 chars/page, 2000 total, pages 1-3 foreground.
- `src/utils/DataMasking.ts` — PII (Aadhaar/PAN) regex masking. Must stay in the indexing path; never index unmasked content.
- `src/utils/TextEnrichment.ts`, `Soundex.ts`, `HindiTranslit.ts`, `DocumentClassifier.ts` — search-index enrichment and zero-cost NLP classification ("Invoice", "ID Proof", smart titles).

**State:** `src/hooks/PinpointerContext.tsx` wraps `usePinpointer()` in a single provider. **Screens must use `usePinpointerShared()`, never `usePinpointer()` directly** — duplicate instances spawn duplicate sync engines and native listeners (fixed as "H7"). `usePinpointer` composes `useSearch`, `useGallerySync`, `useDocumentSync`, `useVoiceRecording`.

**Native Android modules** (`android/app/src/main/java/ai/runanywhere/starter/`), accessed via `NativeModules`:
- `NativePdfModule` (Kotlin) — PDF text extraction + rasterization
- `OCRModule` (Java), `StorageModule` (Java)
- `SherpaOnnxModule` (Kotlin) — on-device STT via sherpa-onnx Whisper (model downloaded by `download-models.js`, ~165 MB)
- `NativeAudioModule` — audio recording

**Voice:** sherpa-onnx Whisper STT, fully offline. TTS models exist in `download-models.js` but are commented out (removed to shrink APK); uncomment there to re-enable. `usePinpointer` strips conversational prefixes ("search for my...") from transcriptions before querying.

**Entry:** `src/App.tsx` — providers order: `GestureHandlerRootView` → `ModelServiceProvider` → `PinpointerProvider`. `setupDatabase()` runs in App mount effect; `closeDatabase()` on unmount.

## Conventions

- Path aliases: none — imports are relative (`../utils/...`).
- Logging via `src/utils/AppLogger.ts`, not raw `console.log` (pipelines already use it).
- Schema migrations: add a new entry to the end of `MIGRATIONS` in `src/database/connection.ts` (tracked with `PRAGMA user_version`, one transaction each). Never edit an old migration. The older inline `try { ALTER TABLE ... } catch {}` statements stay as they are.
- Indexing runs only through `src/services/IndexingService.ts` (one queue, one job at a time). Hooks call it and must not start sync loops themselves. Per-file progress lives in the `files` table (`src/database/fileState.ts`): call `noteFileSeen()` to find out which stages a file still needs.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
