 PinPointer — 360° Technical Audit
                                                                                          
  Scope: ~11,100 lines across src/ (29 TS/TSX), android/ (7 native + 4 gradle), ios/ (5
  native + plist), configs, and deps. Every CRITICAL/HIGH below was re-verified by reading  the cited lines myself, not taken on subagent faith.

  Verification notes / corrections:
  - SherpaOnnxModule.kt:419 — flagged by an auditor as an operator-precedence bug. False 
  positive. Kotlin elvis binds tighter than >=, so it parses correctly as
  (playbackHeadPosition ?: 0) >= pcmData.size/2. Excluded.
  - "HomeScreen always mounted → second usePinpointer" — partially corrected. App.tsx:50
  sets initialRouteName="Pinpointer"; Home is a separate stack screen. The real bug is
  that both HomeScreen.tsx:32 and PinpointerScreen.tsx:66 independently instantiate the
  heavyweight usePinpointer(), so they collide whenever both sit in the nav stack.        
  Reframed below as HIGH (not CRITICAL).

  ---
  🔴 CRITICAL — Showstoppers / Crashes / Privacy breach

  C1. ProGuard strips sherpa-onnx JNI classes → release builds crash on first STT/TTS     

  File: android/app/proguard-rules.pro:1-11 (empty — comments only) +
  android/app/build.gradle:17,62,99 + SherpaOnnxModule.kt:12,32,104
  Flaw: enableProguardInReleaseBuilds = true and minifyEnabled is on for release, but     
  proguard-rules.pro contains zero keep rules. sherpa-onnx ships as a raw AAR (fileTree   
  libs/*.aar, line 99); its libsherpa-onnx-jni.so reflects back into Java classes
  (OfflineRecognizer, GeneratedAudio, getSampleRate, config types) by literal name. R8    
  renames/strips them. Debug builds work; release builds break.
  Worst case: App installs fine, then System.loadLibrary succeeds but the first
  initSTT/initTTS throws NATIVE_LIB_ERROR/UnsatisfiedLinkError or SIGSEGV — voice features
  are 100% dead in production only. The exact failure you can't reproduce in debug.       
  Fix:
  proguard
  # proguard-rules.pro
  -keep class com.k2fsa.sherpa.onnx.** { *; }
  -keepclassmembers class com.k2fsa.sherpa.onnx.** { native <methods>; }
  -dontwarn com.k2fsa.sherpa.onnx.**
  Add a CI assembleRelease smoke test so a future strip regression fails the build.       

  ---
  C2. PII masking is never applied to scanned images — Aadhaar/PAN stored in plaintext    

  File: src/hooks/usePinpointer.ts:101, src/screens/SmartClipboardScreen.tsx:301 (vs.     
  correct path at src/utils/DocumentPipeline.ts:236)
  Flaw: maskSensitiveData() is called in exactly one place — the PDF/document pipeline    
  (DocumentPipeline.ts:236). The two image OCR index paths store raw text with no masking:
  // usePinpointer.ts:94-101 — "Scan" a photo of your Aadhaar card
  const vision = await analyzeImage(imageUri);
  const rawText = vision.content;                       // full OCR text, unmasked        
  indexDocument(null, indexableContent, imageUri, 'IMAGE', 'TEXT');
  // SmartClipboardScreen.tsx:301 — "Scan Images" → Save
  indexDocument(null, editedText.trim(), imageUri, 'IMAGE', ...);
  Both feed the SQLite document_index.content column and the FTS5 index (via the
  fts_insert trigger, Database.ts:83-87).
  Worst case: A user photographs their Aadhaar/PAN/bank passbook — the app's headline use 
  case — and the full 12-digit Aadhaar, PAN, and account number are written unmasked into 
  an unencrypted local DB and the search index, then surfaced verbatim in search snippets.
  This defeats the entire "privacy-first" premise and is a real data-protection incident  
  on a lost/rooted device.
  Fix: Mask at the single chokepoint so no caller can bypass it — inside indexDocument    
  (Database.ts:129):
  import { maskSensitiveData } from './utils/DataMasking';
  export const indexDocument = (title, content, filePath, type, detection_type) => {      
    content = maskSensitiveData(content ?? '');          // ← one line, covers every path 
    if (!content.trim() && !title?.trim()) { ... return; }
    ...
  }
  Then remove the now-redundant call at DocumentPipeline.ts:236 (masking twice is harmless
  but dead).

  ---
  C3. Whole document sync runs in one transaction with no rollback → DB lock + total data 
  loss on error

  File: src/hooks/useDocumentSync.ts:123,148,149-159 (+ Database.ts:158-168 —
  rollbackTransaction is exported but never called)
  Flaw:
  beginTransaction();                    // :123 — one BEGIN for the ENTIRE sync
  for (const doc of docsToProcess) {     // :124 — could be hundreds of PDFs
    try { await processPDF(fileUri); }
    catch (pipelineError) { AppLogger.error(...); }   // swallowed, loop continues        
  }
  commitTransaction();                   // :148 — only reached if no throw escapes the   
  loop
  If anything throws between BEGIN and COMMIT (e.g. AsyncStorage, a native crash, OOM     
  mid-PDF), the outer catch at :149 logs and the finally resets UI state — but the        
  transaction is never committed or rolled back. The connection is left holding an open   
  write transaction.
  Worst case: (a) Every other DB write blocks behind the open transaction's WAL lock until
  the process dies → app appears frozen on next sync/search. (b) On the error path, all   
  PDFs indexed in that run are lost (rolled back by connection close), not just the failed
  one. (c) A single huge sync holds a write lock for minutes → battery/thermal spike and  
  UI stalls.
  Fix: Transaction-per-document (or per small batch), with real rollback:
  import { beginTransaction, commitTransaction, rollbackTransaction } from '../Database'; 
  for (const doc of docsToProcess) {
    if (!doc.path) continue;
    const fileUri = `file://${doc.path}`;
    beginTransaction();
    try {
      if (!isFileIndexed(fileUri)) await processPDF(fileUri);
      commitTransaction();
    } catch (e) {
      rollbackTransaction();           // ← actually use it
      AppLogger.error('DocumentSync', `Pipeline failed: ${doc.name}`, e);
    } finally { processed++; setDocSyncCount(processed); }
  }
  GallerySync.ts has the same whole-loop-transaction shape — apply the same fix.

  ---
  C4. iOS missing NSPhotoLibraryUsageDescription → crash on first gallery sync

  File: ios/RunAnywhereStarter/Info.plist (has Microphone :50, SpeechRecognition :52,     
  LocalNetwork :46, Location :48 — no photo-library key)
  Flaw: The app reads the camera roll via @react-native-camera-roll/camera-roll
  (GallerySync.ts, RecentPhotos.ts) but declares no photo-library usage string. iOS       
  hard-crashes any app that touches photos without it.
  Worst case: On iOS, the first gallery sync or "recent photos" read throws This app has  
  crashed because it attempted to access privacy-sensitive data without a usage
  description → instant kill, no recovery.
  Fix:
  <key>NSPhotoLibraryUsageDescription</key>
  <string>PinPointer indexes your photos on-device so you can search them offline. Nothing
  leaves your phone.</string>
  <key>NSPhotoLibraryAddUsageDescription</key>
  <string>PinPointer saves edited images back to your library.</string>

  ---
  C5. sherpa STT decode races teardown → native use-after-free (SIGSEGV) + stream leak    

  File: SherpaOnnxModule.kt:190-236 (decode thread) vs. :450-460
  (onCatalystInstanceDestroy releases recognizer)
  Flaw: stopRecognition decodes on a detached thread {} (:190). There is no
  destroyed/isSTTReady re-check before recognizer?.createStream()/decode()/getResult()    
  (:214-218). If a JS reload or back-nav fires onCatalystInstanceDestroy (:453
  recognizer?.release()) while a decode is in flight, the background thread calls into    
  freed native memory. Separately, stream.release() (:221) is not in a finally — any throw
  in decode/getResult leaks the native stream buffer.
  Worst case: Random SIGSEGV during hot-reload / rapid screen changes (untraceable native 
  crash), plus one leaked native stream per failed decode.
  Fix:
  @Volatile private var destroyed = false
  // in stopRecognition thread:
  val rec = recognizer
  if (destroyed || rec == null) { promise.reject("STT_NOT_READY","destroyed");
  return@thread }
  val stream = rec.createStream()
  try {
      if (stream == null) { promise.reject("DECODE_ERROR","stream null"); return@thread } 
      stream.acceptWaveform(floatArray, sampleRate = SAMPLE_RATE)
      rec.decode(stream)
      promise.resolve(rec.getResult(stream)?.text ?: "")
      emitEvent("onSpeechResults", Arguments.createMap().apply {
          putArray("value", Arguments.createArray().apply {
  pushString(rec.getResult(stream)?.text ?: "") })
      })
  } finally { stream?.release() }
  // onCatalystInstanceDestroy: set destroyed = true BEFORE recognizer?.release()

  ---
  🟠 HIGH — Data loss / Memory / Permissions / Crashes

  H1. TextToSpeechScreen calls a native method that doesn't exist → audio never stops,    
  TypeError

  File: src/screens/TextToSpeechScreen.tsx:235,269 vs. SherpaOnnxModule.kt (only
  stopSpeaking :361 exists; no stopPlayback)
  Flaw: On focus-loss and in the stopPlayback helper, the screen calls
  SherpaOnnxModule.stopPlayback(). The Android SherpaOnnxModule exports stopSpeaking, not 
  stopPlayback (stopPlayback exists only on the other module, NativeAudioModule.kt:280).  
  Calling an undefined native method yields undefined(...) → TypeError, swallowed by      
  .catch(()=>{}) at :235 — so TTS keeps playing after you navigate away.
  Worst case: User leaves the Read-Aloud screen mid-speech; audio plays on forever with no
  visible control; the error is silently eaten so it looks like a "ghost audio" bug.      
  Fix: Use the real method name:
  SherpaOnnxModule.stopSpeaking().catch(() => {});   // :235 and :269

  H2. recordedData!! + non-@Volatile isRecording → background NPE & unstoppable record    
  thread

  File: SherpaOnnxModule.kt:48,155,162,165,199,248
  Flaw: isRecording (:48) is a plain var read in the recording loop (while (isRecording)  
  :162) and written from other threads — no @Volatile, so the loop thread may never       
  observe false. cancelRecognition sets recordedData = null (:248) while the record thread
  still does synchronized(recordedData!!) (:165) and stopRecognition does recordedData!!  
  (:199) — a race → NullPointerException on a background thread (uncaught → crash).       
  Worst case: Mic stays hot after "cancel" (battery/privacy), or a random NPE crash when  
  stop/cancel overlap.
  Fix: @Volatile private var isRecording = false; replace every recordedData!! with a     
  local snapshot:
  val data = recordedData ?: ByteArrayOutputStream()
  synchronized(data) { data.write(buffer, 0, bytesRead) }

  H3. AudioRecord not released on init-failure path → resource leak

  File: SherpaOnnxModule.kt:141-152 (and same pattern in NativeAudioModule.kt)
  Flaw: audioRecord = AudioRecord(...) is constructed (:141), then if state !=
  STATE_INITIALIZED it promise.reject + return (:150) without audioRecord?.release(). Each
  failed start leaks a native AudioRecord (and the mic).
  Worst case: Repeated failed starts (contention, permission flaps) exhaust the audio HAL 
  → mic unusable app-wide until reboot.
  Fix: audioRecord?.release(); audioRecord = null before the reject at :150.

  H4. initSTT/initTTS re-entry leaks native models

  File: SherpaOnnxModule.kt:104,305
  Flaw: Both assign recognizer = OfflineRecognizer(...) / tts = OfflineTts(...) with no   
  check for an existing instance and no .release() of the old one. Any remount or
  double-init (two screens both calling init) leaks a full whisper/piper model (~tens of  
  MB native).
  Worst case: Native OOM after a few navigations → STT_INIT_ERROR or process kill on      
  low-RAM devices.
  Fix: Guard + release:
  if (isSTTReady && recognizer != null) { promise.resolve(true); return@thread }
  recognizer?.release()
  recognizer = OfflineRecognizer(...)

  H5. ImageResizer temp files never deleted → unbounded cache growth

  File: src/utils/VisionPipeline.ts:94-105
  Flaw: analyzeImage downsamples every image to a temp JPEG (processUri = resized.uri) and
  never deletes it. It runs once per photo and once per PDF page
  (DocumentPipeline.ts:185). NativePdfModule.cleanupCache() only clears its own pdf_pages/
  dir, not the resizer's cache.
  Worst case: Indexing a few thousand photos leaks a few GB of orphaned JPEGs in app cache
  → storage pressure, OS may evict other cache, "storage full" on the user.
  Fix: Delete after OCR:
  try { const { latin, hindi } = await runOCR(processUri); ... }
  finally {
    if (processUri !== originalUri) {
      await RNFS.unlink(processUri.replace('file://','')).catch(()=>{});
    }
  }

  H6. PDF rasterization leaks Bitmap/FD/page on error + OOM on large pages

  File: android/.../NativePdfModule.kt:36-40,81-107
  Flaw: getPdfInfo opens fd + PdfRenderer (:36-37) and closes them only on the happy path 
  (:39-40) — a throw leaves the FD open. In rasterizePages, each page allocates an        
  ARGB_8888 bitmap at 2× (a letter page ≈ 1224×1584×4 ≈ 7.7 MB); page.close() (:96) and   
  bitmap.recycle() (:104) are not in finally, and there's no page-dimension cap. One      
  exception leaks the bitmap + page + renderer + FD.
  Worst case: A corrupt/oversized PDF (e.g. an A0 poster at 2× = 100+ MB bitmap) →        
  OutOfMemoryError native crash mid-sync; partial leaks accumulate across the sync.       
  Fix: wrap renderer in use {}/try-finally, recycle bitmap in finally, and cap scale by   
  total pixels:
  val px = page.width.toLong() * page.height
  val scale = if (px > 4_000_000) 1 else 2   // cap rasterized size
  val bitmap = Bitmap.createBitmap(page.width*scale, page.height*scale,
  Bitmap.Config.ARGB_8888)
  try { /* render + compress */ } finally { bitmap.recycle(); page.close() }
  Use ParcelFileDescriptor/PdfRenderer inside try { } finally { renderer.close();
  fd.close() }.

  H7. Two screens each instantiate the full usePinpointer() → duplicate listeners &       
  desynced state

  File: src/screens/HomeScreen.tsx:32 and src/screens/PinpointerScreen.tsx:66 (hook at    
  src/hooks/usePinpointer.ts:17)
  Flaw: usePinpointer composes useSearch + useGallerySync + useDocumentSync +
  useVoiceRecording with local useState only — no shared context. Both screens call it.   
  When both are in the navigation stack, you get two independent sync engines and two     
  onSpeechResults/onSpeechStart native listeners, plus two copies of "is syncing" state.  
  **Worst case

  Thought for 10s (ctrl+o to expand)

● case:** Voice transcription fires into both hook instances (search text set twice / into
  an unmounted screen); gallery + document syncs run concurrently against the same DB and
  the same AsyncStorage cursors → the C3 transaction bug collides across two syncs,
  doubling lock contention. State shown on Home desyncs from Pinpointer.
  Fix: Lift the composed state into one React context provider (ModelServiceProvider
  already wraps the app at App.tsx:46) and have both screens consume it, so there's
  exactly one sync engine and one set of native listeners:
  const PinpointerCtx = createContext<ReturnType<typeof usePinpointer>>(null!);
  export const PinpointerProvider = ({children}) => {
    const value = usePinpointer();
    return <PinpointerCtx.Provider value={value}>{children}</PinpointerCtx.Provider>;
  };
  export const usePinpointerShared = () => useContext(PinpointerCtx);

  H8. Unbounded transcriptionHistory rendered with .map() + index keys

  File: src/screens/SpeechToTextScreen.tsx:24,105
  Flaw: setTranscriptionHistory(prev => [text, ...prev]) (:24) never caps growth, rendered
  via non-virtualized .map((item, index) => <View key={index}>) (:105). Because it's      
  prepend-only, index keys shift every item on each new transcription → React remounts all
  rows instead of inserting one.
  Worst case: Long dictation sessions grow memory without bound and each new result       
  re-renders the entire history → compounding jank, eventual ANR.
  Fix: Cap the list and use a stable key:
  setTranscriptionHistory(prev => [text, ...prev].slice(0, 100));   // :24
  // :105 — stable id, not index
  transcriptionHistory.map((item, i) => <View key={`${i}-${item.slice(0,8)}`}> ...)       

  H9. Cleartext-to-Metro removed but targetSdk 36 blocks it → debug builds can't load     
  bundle

  File: android/.../AndroidManifest.xml:18-26 (+ deleted
  res/xml/network_security_config.xml)
  Flaw: Git confirms HEAD's manifest carried usesCleartextTraffic="true" + a
  network-security-config allowing cleartext to localhost/10.0.2.2. Both are now gone and 
  the XML deleted. targetSdk 36 blocks cleartext HTTP by default.
  Worst case: Debug builds on a physical device/emulator can't fetch the JS bundle over   
  http:// from Metro → red "could not connect to development server." Release is
  unaffected (bundle is embedded).
  Fix: Debug-only flag, not a global hole:
  <application
    android:usesCleartextTraffic="true"   <!-- or scope via a debug-only
  networkSecurityConfig -->
    ...>
  Better: restore a debug/res/xml/network_security_config.xml limited to
  localhost/10.0.2.2 and reference it only in the debug variant.

  ---
  🟡 MEDIUM — Performance / Edge cases / Correctness

  M1. MANAGE_EXTERNAL_STORAGE (All Files Access) — AndroidManifest.xml:7, used by
  StorageModule.java:105-120. Play Store policy rejection (special justification required)
  + needless attack surface for an app that only needs documents/photos. Fix: drop it;    
  use SAF + READ_MEDIA_IMAGES.

  M2. Release APK signed with the public debug keystore — build.gradle:46-52,61. Anyone   
  with the well-known debug.keystore (password android) can sign "updates" the device     
  trusts; Play rejects debug-signed releases. Fix: real signingConfigs.release from       
  keystore.properties/env.

  M3. APK ships ~300 MB of uncompressed models — build.gradle:32-34 noCompress over 309 MB
  of assets (verified: whisper 154 MB + piper 78 MB + piper-hi 78 MB). Over Play's 200 MB 
  limit → sideload-only. aaptOptions is also deprecated under AGP 8. Fix:
  androidResources { noCompress += [...] } + Play Asset Delivery or download-on-first-run 
  (the download-models.js infra already exists).

  M4. OCR garbage indexed as valid text — DocumentPipeline.ts:107-110,291. Native PDF text
  is read as 'ascii' and regex-scanned; a corrupt/truncated PDF yields binary garbage     
  that passes MIN_TEXT_LENGTH → junk stored in the index, plus catastrophic-backtrack risk
  on 200 KB of arbitrary bytes. Fix: run isGarbageText (already exists in
  VisionPipeline.ts:27) on nativeText before treating the PDF as digital.

  M5. cleanupCache() skipped on the error path — DocumentPipeline.ts:204 sits after the   
  page loop; the catch returns at :213-215 before it. Any OCR/page error leaks the        
  rasterized JPEGs. Fix: move into finally.

  M6. ML Kit TextRecognizer never closed — OCRModule.java:28,33. Created per scanImage,   
  implements Closeable, never closed; only IOException caught, so a malformed URI throws  
  uncaught and never resolves/rejects the promise → JS await hangs forever (stuck
  spinner). Fix: recognizer.close() in both listeners; catch (Exception e) {
  promise.reject(...) }.

  M7. openPDF/shareImage swallow all errors — StorageModule.java:123,150 (no Promise      
  param; e.printStackTrace() at :146,177). When FileProvider.getUriForFile can't map a    
  path outside file_paths.xml roots it throws IllegalArgumentException — user taps "Open  
  PDF," nothing happens, no error. Fix: add Promise + promise.reject(...) in catch.       

  M8. Audio OOM on long recordings — NativeAudioModule.kt:121-139 keeps pcmData + wavData 
  + base64Audio live simultaneously and pushes both path and base64 over the bridge (a    
  5-min clip ≈ 30 MB live). :235/SherpaOnnxModule.kt:408 allocate one MODE_STATIC
  AudioTrack buffer the size of the whole clip. Fix: stream PCM to the WAV file, return   
  only path, drop base64; use MODE_STREAM with chunked writes.

  M9. onSpeechResults payload unvalidated — useVoiceRecording.ts:56-62. event?.value?.[0] 
  indexed on an untyped payload, then .trim() (:59) — a non-string value throws inside the
  emitter, leaving isTranscribing stuck true. Fix: const raw = event?.value; const text = 
  Array.isArray(raw) ? raw[0] : raw; if (typeof text === 'string' && text.trim()) ....    

  M10. No yield between PDF pages / images during sync — DocumentPipeline.ts:182-200 runs 
  heavy analyzeImage back-to-back with no setImmediate; combined with C3's open
  transaction the device is locked into a multi-second burst → UI freeze, thermal
  throttle. Fix: await new Promise(r => setImmediate(r)) between items (mirror
  GallerySync's DEEP_SLEEP_MS).

  M11. AppLogger writes raw content to logcat in release — AppLogger.ts:25-36 always      
  console.log/warn/error. It's an in-memory ring buffer (no disk write — good), but       
  console.error(tag, msg, detail) with a raw OCR/PII detail reaches Android logcat in     
  release builds, readable by any app with READ_LOGS/adb. Fix: gate bodies behind __DEV__;
  in release log tag + error code only, never detail.

  M12. Aadhaar/PAN mask regex gaps — DataMasking.ts:16,23. maskAadhaar matches any        
  12-digit run (order IDs, timestamps → corrupted), and misses an Aadhaar embedded in a   
  longer digit run (\b won't fire mid-digits). maskPAN is uppercase-only — OCR yields     
  abcde1234f → no match → PAN stored clear. Bank-account masking is disabled (:59) and    
  emails/cards aren't masked at all. Fix: anchor Aadhaar
  (?<!\d)([2-9]\d{3})[\s-]?\d{4}[\s-]?\d{4}(?!\d); make PAN case-insensitive and
  re-uppercase; add email/card rules.

  M13. react-native-screens is mocked out — react-native.config.js +
  src/react-native-screens-mock.js. A core navigation lib is stubbed and disabled. This   
  usually hides a real New-Architecture/version incompatibility. Fix: resolve the
  underlying build error and delete the mock, or pin react-native-screens to a known-good 
  version — don't ship a mock of a core dep.

  ---
  ⚪ LOW — Code smells

  - L1 Database.ts:65-70 — migrations are try{ALTER}catch(_){}, no PRAGMA user_version; a 
  real failure is indistinguishable from "column exists." page_count/pdf_status (:69-70)  
  are written nowhere → dead columns.
  - L2 Database.ts:212 — synonym expansion uses bidirectional includes, so
  "pant"/"expand"/"pancake" pull in the whole PAN-card synonym set; "bill"/"dl"/"lic"     
  likewise. Fix: whole-token match only.
  - L3 Database.ts:268-294 — LIKE fallback fans out synonyms×(content+title)+soundex per  
  word, all non-indexable full scans, no cap on word count; runs synchronously on the JS  
  thread. Fix: cap expanded terms/words; long-term push synonyms into FTS5.
  - L4 useSearch.ts:47 — runs searchDocuments a second time per settled keystroke just to 
  get .length. Fix: reuse searchResults.length.
  - L5 useSearch.ts:22,49,61 — .then(setSearchHistory) with no .catch and no unmount      
  guard.
  - L6 PointAndSpeakScreen.tsx:134, TextToSpeechScreen.tsx:257,
  SmartClipboardScreen.tsx:358 — setState after await SherpaOnnxModule.speak(...) with no 
  mounted guard → unmounted-setState warning when navigating away mid-speech.
  - L7 gallery.tsx:30-31,186 — module-level Dimensions.get("window") frozen at import;    
  cards/modal mis-sized after rotation. Fix: useWindowDimensions().
  - L8 SmartClipboardScreen.tsx:309 — Alert('Saved') fires unconditionally though
  indexDocument swallows its own DB errors internally → false success on a failed write.  
  Fix: have indexDocument return boolean, gate the alert.
  - L9 ModelDownloadSheet.tsx:133-142 — a "Debug Assets" button ships in production UI,   
  dumping asset filenames into an Alert; animations at :32,111 never stopped on cleanup.  
  - L10 package.json:30,36 — react-native-image-resizer@1.4.5 deprecated/unmaintained (on 
  the critical OCR path); react-native-sound@0.13.0 declared but never imported;
  react-native.config.js:17 references react-native-audio-recorder-player which isn't a   
  dependency at all.
  - L11 package.json:23,50 — React 19.2.0 + RN 0.83.1 is a bleeding-edge pairing;
  @types/react ~19.1.0 conflicts with react-native-quick-sqlite's resolutions:
  @types/react ^18. Fix: add a root overrides forcing @types/react 19.x.
  - L12 download-models.js:118,124 — execSync(\tar ... "${path}"`)interpolates paths into 
  a shell string (not currently exploitable — values are fixed), runs inpostinstall,      
  downloads ~230 MB with **no checksum/signature**. *Fix:* execFileSync('tar', [...args])`
  + SHA-256 verify.
  - L13 RecentPhotos.ts:16-26 — JSON.parse result used without shape validation; .filter(p
  => p.uri !== uri) assumes every element has .uri.
  - L14 StorageModule.java:89-92 — size-mismatch validation only logs a warning then      
  resolves; a truncated model copy passes. Fix: treat real mismatch as error, delete      
  partial.
  - L15 SherpaOnnxModule.kt:417 — playback-completion while loop has no max-wait bound; a 
  stuck playbackHeadPosition keeps the thread alive until stopSpeaking.
  - L16 NativeAudioModule.kt:185 — manual PCM→short sign handling skews the level meter;  
  SherpaOnnxModule.kt:207 already does it correctly with asShortBuffer().

  Verified NOT vulnerable (so they aren't re-flagged): SQL injection — FTS terms are      
  stripped of MATCH operators (Database.ts:235) and the LIKE fallback is fully
  parameterized; iOS ATS is correctly locked down (NSAllowsArbitraryLoads=false,
  localhost-only); allowBackup="false" is set; FileProvider is exported="false" with      
  grantUriPermissions; the only activity is the launcher (no exported components); no     
  clipboard auto-read on focus anywhere.

  ---
  Prioritized action plan

  🚑 Fix before any release build (blocks shipping):
  1. C1 — add sherpa-onnx ProGuard keep rules. Without this, release builds are broken;   
  debug works, so it'll ambush you. Add a CI assembleRelease.
  2. C2 — wire maskSensitiveData into indexDocument. One line closes a live PII leak on   
  the app's headline feature.
  3. C4 — add NSPhotoLibraryUsageDescription or iOS crashes on first sync.
  4. C5 + H2/H3/H4 — the sherpa native lifecycle fixes (use-after-free, recordedData!!,   
  AudioRecord leak, init re-entry). These are the random-crash class.
  5. C3 — per-document transactions + real rollback. Fixes data loss and the DB-lock      
  freeze.
  6. H1 — stopPlayback → stopSpeaking (one-word fix; ghost audio today).

  🔧 Fix soon (data integrity / memory / store-readiness):
  7. H5/H6 — delete ImageResizer temp files; PDF bitmap/FD finally + pixel cap (stops the 
  multi-GB cache leak and raster OOM).
  8. H7 — single shared usePinpointer via context (kills duplicate sync/listeners).       
  9. M2/M3/M1 — release keystore, move models off-APK (Play Asset Delivery), drop
  MANAGE_EXTERNAL_STORAGE. These three gate Play Store submission.
  10. M6/M7 — close TextRecognizer, add promises to openPDF/shareImage (hangs + silent    
  failures).
  11. H8 — cap + stable-key the STT history list.
  12. M11/M12 — gate release logging behind __DEV__; fix the PAN/Aadhaar regex gaps.      

  🏗️ Longer-term architecture:
  13. M13 — resolve why react-native-screens is mocked instead of shipping a stub of a    
  core nav dep.
  14. L10/L11/L12 — dependency hygiene: migrate to @bam.tech/react-native-image-resizer,  
  remove dead react-native-sound, pin @types/react via root overrides, add model checksum 
  verification to download-models.js.
  15. Database hardening — adopt PRAGMA user_version migrations (L1); consider SQLCipher  
  for pinpoint.db given C2 (an unencrypted local DB holding masked-but-still-sensitive    
  content is the next privacy step); move synonym expansion into FTS5 instead of LIKE     
  fan-out (L2/L3).
  16. Offload the hot path — indexing/sync is synchronous JS-thread work (M10); move      
  classification + OCR orchestration to a background worker with yields so the UI stays   
  responsive and thermal pressure drops during large syncs.

  Net: the architecture is sound (FTS5 with LIKE fallback, sequential vision pipeline with
  early-exit, WAL mode, in-memory-only logger). The blockers are concentrated in
  release-build config (C1, M2, M3), the PII masking chokepoint (C2), and the sherpa      
  native lifecycle (C5, H2-H4) — all fixable in a focused pass. The single
  highest-leverage change is C2: one line in indexDocument plugs the privacy leak across  
  every caller at once.