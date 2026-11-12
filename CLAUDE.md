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
npx jest                    # 74 suites / ~1930 tests (must all pass). Slow on the D: drive; use --silent (--runInBand if workers run out of memory)
cd android && ./gradlew assembleDebug    # native compile check
adb shell cmd jobscheduler run -f com.pinpointer.app 4711   # force the charging-time indexing job
cd tools/preview && npm install && npm run dev   # browser preview of the UI kit and screens (react-native-web), `npm run shots -- out` for phone screenshots (stories in `tools/preview/src/stories.tsx`, including `search-*`; `tools/preview/src/shims/` swaps the database, permissions, pickers and text reading for sample data, so whole screens like Photos, Papers and Scan render)
```

- CLIP models (`android/app/src/main/assets/models/clip/vision_encoder_int8.onnx`, `text_encoder_int8.onnx`, vocab) are gitignored and made with `scripts/export_mobileclip.py`. Without them semantic search is off, and the app falls back to text search.
- `react-native-screens` is pinned to exactly `4.23.0` in `package.json`. Only `@react-navigation/stack` uses it, and 4.30.1 fails React Native 0.83's codegen (`generateCodegenSchemaFromJavaScript`), which breaks the Android build. Upgrade it only together with React Native.
- `fix_aar.py` (untracked) strips `libonnxruntime.so` from the sherpa-onnx AAR so it doesn't clash with `onnxruntime-android` 1.20.0 (`pickFirst`). If STT or CLIP crashes at load, check this first.
- Done means: tsc clean, lint clean, all Jest tests pass, and for native changes, `assembleDebug` builds.

## Architecture

**Data flow:** gallery/PDFs → `IndexingService` queue → pipelines (Vision/Document) → enrichment (Indic transliteration, sound keys, concepts, PII masking, classifier) → op-sqlite (FTS5 + sqlite-vec) → hybrid search.

### Database: `src/database/`
- `connection.ts`: singleton op-sqlite DB `pinpoint.db` (WAL). **`MIGRATIONS[]`** is versioned with `PRAGMA user_version`, one transaction each. Migration 1 adds the `files` table and seeds it from the existing index. Migration 2 adds Indian-language search keys and the FTS5 tokenizer, and re-masks old rows.
- `documents.ts`: `indexDocument` (masks PII, writes search keys, deletes the old vector), `isFileIndexed`, `clearIndex` (also clears `vec_index`).
- `fileState.ts`: the **`files` table**, with per-file, per-stage state: `ocr` and `embed` status (`pending|done|failed|skipped`), embed model (`CURRENT_EMBED_MODEL = 'mobileclip2-s0'`), attempts (`MAX_ATTEMPTS = 3`), last error and mtime. Call `noteFileSeen(uri, kind, mtime)` to get the stages a file still needs. `getReadyCounts()` gives photos and PDFs that are no longer pending (the "120 of 2,400" numbers).
- `vectors.ts`: sqlite-vec `vec_index` (float32[512]) plus `getImagesMissingEmbeddings` for the backfill.
- `collections.ts` + `collectionTerms.ts`: Home's "Find quickly" counts and photos (bounded, read-only) and CLIP look-alikes; the same terms back search, so a tile's count matches its search.
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
- `src/utils/Collections.ts`: the six collections (ID cards, Bills, Medicine, Bank, Screenshots, Family) as concept ids plus exact phrases. A whole query naming one (English or Hindi) searches the whole collection (`collectionForQuery`).
- `src/utils/ConceptTable.ts`: about 50 Hindi/Hinglish/English concepts with meaning IDs.
- `src/utils/HindiTranslit.ts`, `TextEnrichment.ts`, `Soundex.ts`, `DocumentClassifier.ts`: enrichment, classification and smart titles (titles are masked).
- `src/utils/DataMasking.ts`: Aadhaar, PAN and phone, including Indic digits. **Masking happens at index time. Never store unmasked content or titles.**

### Permissions and import
- `src/utils/StoragePermissions.ts`: photo access (`full|limited|denied|blocked`, including Android 14+ `READ_MEDIA_VISUAL_USER_SELECTED`), a plain-language Settings guide, re-checks on return to the app, and a real All Files Access check (`StorageModule.isExternalStorageManager`). PDF access is `getDocumentAccess()` → `all|folders|none`; `allFilesAccessApplies()` is Android 11+; `keepLimitedAccess()` / `isLimitedAccessKept()` remember "Keep my choice" for partial photo access.
- `src/hooks/useStorageAccess.ts`: `usePhotoAccess()` and `useDocumentAccess()` keep that access current (on mount and on every return to the app) and wrap the asks (`request`, `openSettings`, `allowAll`, `chooseFolder`, `pickFiles`). Screens use these instead of calling StoragePermissions directly. A plain check can't tell "won't ask again" from "denied", so once a request comes back `blocked` the hook keeps saying `blocked` for the session (until photos are allowed); callers then open Settings. `photoSettingsWording()` picks the Settings steps' words by Android version.
- `src/utils/PdfImport.ts` + `DocumentAccessModule.kt`: SAF folder picker with lasting access, plus "Share / Open with Pinpointer" (MainActivity intents). PDFs are copied into app storage.
- Manifest: `MANAGE_EXTERNAL_STORAGE` (needs a Play declaration, "on-device file search"), `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED`, legacy storage capped at `maxSdkVersion 32`, `RECEIVE_BOOT_COMPLETED`.

### State and UI
- `src/hooks/PinpointerContext.tsx` provides one `usePinpointer()`. **Screens must use `usePinpointerShared()`.** A second instance means duplicate sync engines and listeners.
- Hooks (`useGallerySync`, `useDocumentSync`) only handle permissions, alerts and progress. They call `IndexingService` and must never run sync loops themselves.
- `src/hooks/useHomeOverview.ts`: Home's tiles (words via `collections.ts`, Screenshots from the MediaStore album, Family by CLIP after a 3 s delay), photo totals and recent photos; loads after the first frame, never asks for permission, refreshes gently while indexing runs.
- `src/hooks/useIndexingProgress.ts`: live photo and PDF progress for any screen, whoever started the work (listens to `IndexingService`, re-reads `getReadyCounts()` at most every 500 ms, counts every photo with `getGalleryTotalCount()`, which sums the camera-roll albums). The pure part is `toIndexingProgress`.
- Navigation (`src/App.tsx`, `src/navigation/`): a stack whose `Main` route is Pinpointer's own bottom-tab navigator (`MainTabs.tsx`, built on React Navigation's `TabRouter`, no extra package). Tabs: `Pinpointer` (Home/search), `Gallery` (Photos), `DocumentVault` (Papers), `Settings`; the raised Scan button in the middle opens `SmartClipboard` on the stack. Tabs mount on first visit and stay mounted. Screens type navigation with `RootStackParamList` (all routes by name) and hide the bar with `setOptions({ tabBarHidden: true })`. `MainTabs` takes a `banner(routeName)` slot drawn just above the bar (hidden with it); App uses it for `PhotoAccessBanner` on Home (Photos has its own notice in the page).
- First run (`FirstRunScreen`, steps in `src/screens/firstRun/`): Welcome (language, the scan animation) → Photos (asks in plain words; written-out Settings steps once Android won't ask again) → PDFs (All files access, or one folder; only on Android 11+) → Ready (starts `deepGallerySync`, then `documentSync` (also for PDFs picked one by one), and shows "120 of 2,400" from `useIndexingProgress`; allowing more while a pass runs queues one more pass, since the queue joins the running job). Steps already allowed are skipped. `useFirstRunGate()` + `utils/FirstRun.ts` decide at start (`FirstRun` route vs `Main`); people updating with an existing index skip it. Every step has "Not now", and Android back never traps anyone.
- `PhotoAccessBanner`: shown only while some photos, not all, are allowed. First tap reopens Android's photo dialog, the next opens Settings; "Keep my choice" hides it for good.
- `ModelDownloadSheet` ("Voice and photo search"): whether voice search (Whisper) and photo search (CLIP, `areClipModelsAvailable()`) work right now, plus the one fix. Opened from Settings → Search.
- Views and containers: screens that need data keep the layout in a plain view (`SettingsView`, `ReadyView`, `PhotoAccessBannerView`, `ModelSheetView`, the first-run steps) with its own file, so `tools/preview` can show it without native modules.
- Screens: `PinpointerScreen` (home/search: state and wiring only; its parts are in `src/screens/pinpointer/`: `Home` (wiring) + `HomeView`/`HomeParts` (search and mic, status line or progress card, the six "Find quickly" tiles, Important shelf, recently opened), and the search screen `SearchOverlay` (mounts only while open; filter chips with counts, "Also searched", deleted files leave the list with a toast) built from `ResultItem` (Photo/Paper rows, `resultInfo.ts`), `MatchedSnippet` (lock-on corners on the first matched word), `RecentSearches` (Today/Earlier, queries masked again on display), `ListeningPanel`, `NothingFound`, `SearchBar` and `openResult.ts`; photos open in the shared `components/PhotoViewer` with the matched words marked), `gallery`, `DocumentVaultScreen`, `SmartClipboardScreen`, `SettingsScreen` (language, what Pinpointer can see, voice and photo search, privacy, version), `FirstRunScreen`, `PdfFoldersScreen` (stack route `PdfFolders`: Downloads/Documents, chosen folders with Remove, add a folder or PDFs). Photos (`gallery`) lists every phone photo by day with All/Today/Yesterday/Last 7 days/Screenshots/Important (dates in `utils/PhotoDates.ts`, `i18n/dates.ts`); Papers groups PDFs into six tiles (`utils/PaperGroups.ts`) and reads places from `hooks/usePdfPlaces.ts`; Scan (`SmartClipboardScreen`) shows "No words found" for photos without text (labels are not text) and keeps copies in memory only. `components/PhotoViewer.tsx` is the shared full-screen viewer (`highlightTerms`, Read text, Important); `getDocumentByPath` gives it the stored text. Point & Speak and Speech-to-Text were removed.
- Voice: sherpa-onnx Whisper base.en STT (`SherpaOnnxModule`, `useVoiceRecording`). The recorder sends the real mic level (`onSpeechVolume`, `utils/MicLevel.ts`): a pause after speech stops and transcribes, silence cancels (no made-up searches), `cancelListening` stops without searching. TTS is off.
- `utils/MatchTerms.ts`: the words in a result that a query matched (prefix, sound key, concept, across scripts), "Also searched" words and snippets that start at the first match.
- Entry: `src/App.tsx` (GestureHandlerRootView → SafeAreaProvider → LanguageProvider → ToastProvider → ModelServiceProvider → PinpointerProvider; `setupDatabase()` and `scheduleBackgroundIndexing()` on mount; the first-run gate picks the first route). `index.js` also registers the headless task.

### Design system (`src/theme/`, `src/components/ui/`, `src/i18n/`)
- Launch look: light, high-contrast. Spec: the design concept (https://claude.ai/artifact/5J9fnr87FASsXKzmC6j82E) and `src/components/ui/README.md` (the guide to every part).
- `theme/`: `Colors` (semantic, all text pairs ≥ 4.5:1, checked by `theme/__tests__`), `Beam` (cyan → violet gradient, only on things that find), `Tints`, `Space`/`GUTTER`/`Radius`/`Touch`/`Elevation` (`boxShadow`), `Type` (Mukta, Latin + Devanagari, min 16sp, body 18sp), `Duration`/`Ease`/`Spring`/`Stagger`. `Colors.lineMedium` is for idle dots and drawn lines (never text); `Art` holds the colours of drawn stand-in photos (first-run art). `AppColors` is the old dark palette, kept only until every screen is restyled.
- Fonts: `android/app/src/main/assets/fonts/Mukta-*.ttf` (OFL), one family per weight; never add `fontWeight` to a Mukta style.
- `components/ui/`: 25 shared parts (AppText, Icon, Button, IconButton, SearchField, Chip/Tag, Card/ListRow, ProgressBar/Ring/Card, EmptyState, Sheet, Toast, TabBar, Screen, the beam, lock-on corners, the mark...).
- `i18n/`: every string in English and Hindi (`strings.ts`, plain words, jargon glossary at the top), `useStrings()` → `t()`, `ago()`, `setLang()`; the choice is saved in AsyncStorage, Hindi phones start in Hindi.
- `utils/PinnedItems.ts` + `hooks/usePinnedItems.ts`: "Important" stars, AsyncStorage, synced across screens (titles must be masked).
- `hooks/useReducedMotion.ts`, `hooks/useScreenFocus.ts` (focus that also works outside a navigator).

### Native modules (`android/app/src/main/java/com/pinpointer/app/`)
`MobileCLIPModule` (own thread, int8 models, ORT 1.20; decodes file paths and the `content://` URIs gallery photos use) + `BPETokenizer` (CLIP-exact vocab), `NativePdfModule`, `SherpaOnnxModule`, `StorageModule`, `DocumentAccessModule`, `IndexingJobService` + `IndexingSchedulerModule`. The package name and application ID are `com.pinpointer.app`.

## Rules

- Schema change → append a new entry to `MIGRATIONS`. Never edit an old one.
- Indexing → only through `IndexingService`. Record per-file progress in `files` (`fileState.ts`).
- PII → mask before storing (content **and** title). Search history is still unmasked in AsyncStorage (known gap).
- Logging → `AppLogger`, not `console.log`.
- UI → build from `src/components/ui` and `src/theme` tokens; text through `AppText` and `t()` (add every string to `en` and `hi`); 48dp minimum touch (56dp for main actions); respect Reduce Motion; the beam only on things that find. Restyled screens drop `AppColors`.
- Imports are relative (no path aliases).
- Tests live in `__tests__/` next to the code. Native modules are mocked in `jest.setup.js` and `__mocks__/`. Add or adjust tests with every change.
- Don't commit: model files, `.claude/settings.local.json`, crash logs, `graphify-out/` (gitignored, regenerate with `graphify update .`).
- One branch per task (`feat/…`, `fix/…`, `chore/…`). Small commits. Don't push or merge without the owner's OK.
