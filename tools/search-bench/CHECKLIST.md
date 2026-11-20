# Pinpointer on a phone: the full checklist

Everything to check with the real app open, A to Z. The search accuracy part is
measured by the bench (`README.md` in this folder); this list covers it and
everything around it. Photo look-alikes (CLIP), the biggest open question,
have their own section at the end: N.

**Who:** 🤖 = Claude can run it over USB (adb taps found by on-screen text,
screenshots, logs, `dumpsys`); 🖐 = needs a person (speaking, judging whether
words are clear, physical things like unplugging). **Build:** run each section
on the **release** APK (`node device/bench.js build` makes one with the bench
on; a plain `./gradlew assembleRelease` for the last pass), on the target
phone, ideally a 2–3 GB one.

How results are recorded: for each line, pass / fail / note, with a screenshot
for fails. Claude keeps them in `out/device/checklist-results.md`.

## A. Install, start and size

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| A1 | Fresh install starts | `pm clear`, open the app | Welcome step shows in under 3 s, no crash (`logcat` has no `FATAL`) | 🤖 |
| A2 | Cold start time | `am start -W` ×5 after force-stop | Median TotalTime under 2 s on a 2–3 GB phone | 🤖 |
| A3 | APK size | size of `app-release.apk` per ABI | Recorded; CLIP + Whisper + Hindi model inside; no x86 libraries in the phone build | 🤖 |
| A4 | Native libraries load | open search (CLIP text), tap mic (sherpa-onnx) | No `UnsatisfiedLinkError` / `dlopen` errors in logcat (one ONNX Runtime for both) | 🤖 |
| A5 | Release build keeps native classes | same as A4 on release | Voice and photo search work (R8 did not strip JNI classes) | 🤖 |
| A6 | Update over an old version | install previous release, index a few photos, install new over it | No first-run steps; old results still found; migrations 1–4 ran (`PRAGMA user_version` = 4) | 🤖 |
| A7 | Portrait only | rotate the phone | Stays portrait | 🖐 |
| A8 | Works offline | airplane mode, then every section below | Nothing asks for internet; no network errors in logcat | 🤖 |
| A9 | No network calls at all | `dumpsys netstats` / logcat during a full session | Zero bytes sent by `com.pinpointer.app` | 🤖 |

## B. First run (`FirstRunScreen`)

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| B1 | Language choice | Welcome: pick हिंदी, then English | Every word on screen changes; choice survives restart | 🤖 |
| B2 | Hindi phone starts in Hindi | set phone language to Hindi, `pm clear`, open | First screen in Hindi | 🤖 |
| B3 | Scan animation | watch Welcome | Smooth; with Reduce Motion on (Settings → Accessibility → Remove animations) it doesn't move | 🤖 |
| B4 | Photos: allow all | tap Allow → "Allow all" | Moves on to PDFs (Android 11+) or Ready | 🤖 |
| B5 | Photos: some only (Android 14+) | "Select photos" → pick 3 | Moves on; later the PhotoAccessBanner shows on Home | 🤖 |
| B6 | Photos: deny twice | Deny, Deny | Written-out Settings steps appear, in plain words for this Android version; "Not now" works | 🤖 |
| B7 | Photos: allow from Settings | follow B6's steps, come back | The step notices and moves on without another tap | 🤖 |
| B8 | PDFs: All files access | tap Allow all → toggle → back | Moves on to Ready | 🤖 |
| B9 | PDFs: one folder | choose a folder (SAF) | Folder appears in PdfFolders later; its PDFs get indexed | 🤖 |
| B10 | PDFs: pick files one by one | pick 2 PDFs | Both indexed (copies in app storage) | 🤖 |
| B11 | Android 10 and older | on an Android 10 phone/emulator | No All files access step | 🤖 |
| B12 | "Not now" everywhere | skip each step | Lands on Home; nothing breaks; Home explains what's missing | 🤖 |
| B13 | Back button never traps | Android back on every step | Goes back a step or leaves the app; never stuck | 🤖 |
| B14 | Ready: live count | watch Ready | "120 of 2,400" style count rises; matches `getReadyCounts()` | 🤖 |
| B15 | Allowing more mid-pass | allow PDFs while photos index | One more pass queued; nothing indexed twice | 🤖 |
| B16 | Steps already allowed are skipped | grant via adb first, then `pm clear` + open | Goes straight to Ready | 🤖 |
| B17 | Words make sense to an older person | read every step aloud to someone 60+ | They can say what each button will do | 🖐 |

## C. Indexing (`IndexingService`, one queue)

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| C1 | 10,000 photos index fully | bench `index` | `ready.photos` pending = 0; `vectors` ≈ photos with CLIP; time recorded | 🤖 |
| C2 | Speed per photo | bench index log | Recorded (p50 / p95 ms per photo); no photo stuck over 30 s | 🤖 |
| C3 | Memory while indexing | bench samples `dumpsys meminfo` every 30 s | Peak PSS recorded; under 350 MB on a 2–3 GB phone; no `lowmemorykiller` kill in logcat | 🤖 |
| C4 | Heat and battery | bench samples temperature and level | Recorded; under 42 °C | 🤖 |
| C5 | Phone stays usable while indexing | scroll Photos, type in search during indexing | No visible stutter; indexing waits (InteractionGate) and resumes | 🤖 + 🖐 |
| C6 | Resume after kill | force-stop at 40%, reopen | Continues from the saved cursor, doesn't restart | 🤖 |
| C7 | Resume after reboot | reboot mid-index | Charging job (C8) or next open continues | 🤖 |
| C8 | Charging-time job | `cmd jobscheduler run -f com.pinpointer.app 4711` | Runs deep sync → prune → rekey → backfill; stops after 8 min; logs show it | 🤖 |
| C9 | Job stops on unplug | `dumpsys battery unplug` during the job | Stops promptly, saves progress | 🤖 |
| C10 | Job only when charging | `dumpsys jobscheduler` | Constraints: charging, battery not low, storage not low, persisted | 🤖 |
| C11 | New photo appears | take a photo of a bill, return to app | Found by its words within one quick sync | 🤖 (adb push) + 🖐 (camera) |
| C12 | Deleted photo leaves | delete an indexed photo, prune (or tap the result) | Gone from results with the "deleted" toast; no crash | 🤖 |
| C13 | Edited photo re-read | change a photo's file (mtime) | Re-indexed once (files table mtime) | 🤖 |
| C14 | WhatsApp copies read once | push the same JPEG to three folders | One OCR; all three rows; shown once in search and tiles | 🤖 |
| C15 | Broken / huge files | a 0-byte JPEG, a corrupt JPEG, a 50 MP photo, a 200-page PDF, a password PDF | Marked failed after 3 attempts at most; indexing moves on; no crash | 🤖 |
| C16 | Pause | Home → pause indexing | Stops; resume continues | 🤖 |
| C17 | Limited photo access | allow 20 photos only | Only those indexed; counts say so; prune doesn't delete others | 🤖 |
| C18 | Storage nearly full | fill storage to < 200 MB | No crash; indexing pauses or fails gracefully with a plain note | 🤖 |
| C19 | Rekey after a keys version bump | install a build with a higher `SEARCH_KEYS_VERSION` | Old rows rebuilt in the background; search works during it | 🤖 |

## D. Search: accuracy (the bench)

Run `node device/bench.js search`. Report: `out/device/results.report.md`
(final results) and `results.words.report.md` (what shows first, before CLIP).

| # | Check | Measured as | Who |
|---|---|---|---|
| D1 | Exact words (English, Hindi, Hinglish) | right paper 1st / top 3 / top 10 | 🤖 |
| D2 | Across scripts (Hinglish → Hindi paper, English → Hindi paper) | same | 🤖 |
| D3 | Typos (one keyboard slip) | same, and "Showing results for…" | 🤖 |
| D4 | OCR misreadings (real ML Kit, blurred and tilted photos) | same, by blur level | 🤖 |
| D5 | Numbers: account, PNR, policy, last 4 of Aadhaar | found / not found | 🤖 |
| D6 | "Latest" (latest bill, pichla bill, सबसे नया) | right one 1st | 🤖 |
| D7 | Dates and festivals (kal, last month, Diwali 2024, march 2024 bill) | recall in top 10 / 50 | 🤖 |
| D8 | Collections (ID cards, Bills, दवाइयाँ, Bank) | recall and precision; matches the Home tile counts (E3) | 🤖 |
| D9 | What photos show (dog, kutta, कुत्ता, family photo) via CLIP | recall@10 / @50, precision@10; in depth: section N | 🤖 |
| D10 | Nothing to find (giraffe, keyboard mash, emoji) | false alarms (should be 0) | 🤖 |
| D11 | Special characters (`"`, `*`, `AND`, `NEAR(`, SQL) | no failure, answers quickly | 🤖 |
| D12 | Privacy: full Aadhaar / PAN never findable or stored | 0 stored (desk check), Aadhaar search finds nothing | 🤖 |
| D13 | Your own photos | `own-queries.csv`, scored the same way | 🖐 labels, 🤖 runs |
| D14 | Speed | words p50 / p95 ms; CLIP encode ms; look-alike scan ms on 10,000 vectors | 🤖 |
| D15 | Look-alike cutoff tuning | distances recorded per search → best `STAND_OUT_GAP` (section N) | 🤖 |
| D16 | Screenshots (1080 × 2400 PNG in Pictures/Screenshots, status bar, light and dark apps) | words found; "Screenshots" / "स्क्रीन शॉट" / "payment screenshot" vs the album | 🤖 |
| D17 | Photos without text | never in word results; "image" / "img" must not list them (stored placeholder) | 🤖 |
| D18 | PDFs: e-bills, 5-page statements, 8-page policy, Hindi, scanned, locked e-Aadhaar, WhatsApp folder | found / rank; which page and how deep a word can be and still be found | 🤖 |
| D19 | Privacy with real OCR | `privacy.json` after indexing: stored texts holding a long number the mask missed (digit read as a letter), by shape only | 🤖 |

## E. Home (`PinpointerScreen` → Home)

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| E1 | Status / progress card | during and after indexing | Shows progress while running, "last checked" after; "Check again" never pops a permission | 🤖 |
| E2 | Six "Find quickly" tiles | open Home | Counts and thumbnails load after first frame; no blank tiles | 🤖 |
| E3 | Tile count = its search | tap each tile | Same count as the search it opens; copies counted once | 🤖 |
| E4 | Family tile | before and after a search loads CLIP | Shows word matches first, CLIP look-alikes later | 🤖 |
| E5 | Screenshots tile | push 5 screenshots to Pictures/Screenshots | Count includes them | 🤖 |
| E6 | Important shelf | star a photo and a PDF | Both on the shelf; unstar removes; survives restart | 🤖 |
| E7 | Recently opened | open 3 results | They appear, newest first | 🤖 |
| E8 | PhotoAccessBanner | some photos allowed | Banner shows; 1st tap reopens Android's dialog, 2nd opens Settings; "Keep my choice" hides it for good | 🤖 |
| E9 | Search bar + Scan button | tap each | Search opens; Scan opens | 🤖 |

## F. Search screen (`SearchOverlay`)

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| F1 | Results appear while typing | type "bijli" slowly | Words results within 300 ms of stopping; no flicker of old results | 🤖 |
| F2 | CLIP re-rank arrives | type "dog" | List updates once CLIP is ready; first search after start shows words first | 🤖 |
| F3 | Filter chips with counts | search "bill" with photos and PDFs | Photos / Papers chips with right counts; empty filter shows all | 🤖 |
| F4 | "Also searched" words | search "dawai" | Shows the related words used | 🤖 |
| F5 | "Showing results for…" | search "medicne" | Corrected line + "You typed…" | 🤖 |
| F6 | "Newest first" line | "latest bill" | Line shows; order newest first | 🤖 |
| F7 | Date line | "Diwali photos" | "When: Diwali, every year" | 🤖 |
| F8 | Answer line on bills | "bijli bill kitna" | "Amount ₹… · Pay by …" on bill rows; right amount and date for 10 bills checked by eye | 🤖 + 🖐 |
| F9 | Matched snippet + lock-on corners | any word search | Snippet starts at the first matched word; corners on it | 🤖 |
| F10 | Nothing found | "giraffe" | NothingFound view with useful next steps | 🤖 |
| F11 | Recent searches | search 5 things, reopen | Today / Earlier; masked numbers stay masked on display; delete one, clear all | 🤖 |
| F12 | Open a photo result | tap | PhotoViewer opens with matched words marked | 🤖 |
| F13 | Open a PDF result | tap | Opens in a PDF viewer app (or a clear note if none) | 🤖 |
| F14 | Deleted file in results | delete a file, tap its result | Leaves the list with a toast; no crash | 🤖 |
| F15 | Back closes search | Android back | Search closes, Home stays | 🤖 |
| F16 | Very long query, emoji, pasted text | paste a paragraph | No freeze; answers in under 1 s | 🤖 |

## G. Voice ("Speak" in the middle of the tab bar)

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| G1 | Mic permission | first tap | Plain-words ask; deny → clear note; allow → listening | 🤖 |
| G2 | First use loads the model | first tap after install | "Getting voice search ready…" in the bar; listening panel shows | 🤖 |
| G3 | English speech | say "electricity bill", "aadhaar card", "medicine" ×3 each, quiet room | Right words ≥ 8 of 9 | 🖐 |
| G4 | Hindi speech (app in Hindi) | "बिजली का बिल", "आधार कार्ड", "पिछले महीने का बिजली बिल", "दवाई की पर्ची" | Right words ≥ 3 of 4 each | 🖐 |
| G5 | Names from your papers (hotwords) | say a company/name printed in your papers | Heard right | 🖐 |
| G6 | Noisy room / TV on | repeat G3–G4 | Note the drop | 🖐 |
| G7 | Silence cancels | tap mic, say nothing | Cancels, no made-up search | 🖐 |
| G8 | Pause stops | speak, then pause | Stops and searches after the pause | 🖐 |
| G9 | Cancel | tap cancel while listening | Stops, no search | 🤖 |
| G10 | From every tab | tap mic on Photos, Papers, Settings | Goes to Home and listens | 🤖 |
| G11 | Switch language | English → Hindi, tap mic | Hindi model loads, English one freed (memory drops) | 🤖 |
| G12 | Memory with voice | `dumpsys meminfo` before/after Whisper loads | Recorded (Whisper ~160 MB, Hindi ~28 MB) | 🤖 |
| G13 | Older voices, slow speech | someone 60+ tries G3/G4 | Note what fails | 🖐 |

## H. Photos tab (`gallery`)

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| H1 | Every photo by day | open | Days in order; counts match the phone's gallery | 🤖 |
| H2 | Filters | All / Today / Yesterday / Last 7 days / Screenshots / Important | Each shows the right photos (compare to dates pushed) | 🤖 |
| H3 | Scroll 10,000 photos | fling to the bottom and back | No blank rows that stay blank; no crash; memory stable | 🤖 |
| H4 | Progress header | while indexing | Shows progress; grid doesn't redraw every photo | 🤖 |
| H5 | Viewer | open a photo: Read text, Important, swipe | Text shown is the stored (masked) text; star works | 🤖 |
| H6 | Limited access notice | some photos allowed | In-page notice, not the banner | 🤖 |
| H7 | Screenshots filter and tile | PNGs in `Pictures/Screenshots`; on Xiaomi/Redmi also `DCIM/Screenshots` | Both folders counted; count matches the phone's own Screenshots album | 🤖 |
| H8 | Photos without text | open one in the viewer, Read text | "No words" (not the word "image") | 🤖 |

## I. Papers tab (`DocumentVaultScreen`)

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| I1 | Six tiles | open | PDFs grouped right (bills, IDs, medical…) for the bench PDFs | 🤖 |
| I2 | Places | open places list | Downloads, Documents and chosen folders | 🤖 |
| I3 | PdfFolders | add a folder, remove it | Added PDFs indexed; removed folder's PDFs gone after prune | 🤖 |
| I4 | Share to Pinpointer | from Files: Share → Pinpointer (1 and 3 PDFs) | Copied, indexed, findable | 🤖 |
| I5 | Open with Pinpointer | open a PDF with Pinpointer | Same as I4 | 🤖 |
| I6 | Scanned PDF | a PDF that is only images | Text read by OCR (pages 1–3) and findable | 🤖 |
| I7 | Big digital PDF | 200 pages | First 2,000 chars indexed; no hang | 🤖 |
| I8 | Digital PDF text (compressed, as banks and browsers make) | e-bill, statement; logcat "Phase 2" line | Read as text, not sent to OCR (today: always OCR, see FINDINGS 2); time per PDF recorded | 🤖 |
| I9 | Hindi digital PDF | the Hindi notice | Devanagari words found, not garbage | 🤖 |
| I10 | Words deep in a PDF | statement: low on page 1, top of page 2, page 5 | Recorded which are found (today: first 500 chars of pages 1–3) | 🤖 |
| I11 | Password e-Aadhaar | `EAadhaar_….pdf` locked with name + birth year | No crash; something useful happens (today: only the file name is stored) | 🤖 |
| I12 | WhatsApp PDFs | PDFs in `Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents` | Found with All files access (today: never looked at) | 🤖 |

## J. Scan (`SmartClipboardScreen`)

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| J1 | Read text from a photo | pick a bill photo | Words shown, copy works | 🤖 |
| J2 | Photo without text | pick a landscape | "No words found" (labels are not text) | 🤖 |
| J3 | Hindi text | pick a Hindi notice | Devanagari read | 🤖 |
| J4 | Copies stay in memory | copy, kill app | Nothing written to storage (check app files) | 🤖 |
| J5 | Camera | take a photo in Scan | Works, or a clear note if no camera permission | 🖐 |

## K. Settings

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| K1 | Language | switch, go through every tab | Every string changes (no English left in Hindi mode) | 🤖 |
| K2 | What Pinpointer can see | each state of photos / PDFs | Right line; tapping fixes it | 🤖 |
| K3 | Voice and photo search sheet | open | Says ready / needs a fix correctly; fix works | 🤖 |
| K4 | Privacy text, version, credits | open | Version matches the build; credits present (CC BY for the Hindi model) | 🤖 |

## L. Accessibility and plain words

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| L1 | TalkBack | turn on, go through Home, search, a result, Settings | Every button has a clear label; answer line is read | 🖐 |
| L2 | Largest font size | Settings → Display → Font size max | Nothing cut off or overlapping | 🤖 (screenshots) |
| L3 | Display size max | Display size largest | Same | 🤖 |
| L4 | Touch targets | uiautomator dump | Every tappable ≥ 48 dp, main actions ≥ 56 dp | 🤖 |
| L5 | Contrast | screenshots in sunlight-like brightness | Readable | 🖐 |
| L6 | Reduce Motion | Remove animations on | No moving parts anywhere | 🤖 |
| L7 | Plain words | someone 60+ uses the app for 10 min with no help | They find a bill and a photo; note every word they stumble on | 🖐 |

## M. Robustness

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| M1 | Kill during search | search, force-stop, reopen | Opens fine | 🤖 |
| M2 | Low memory | `am send-trim-memory com.pinpointer.app RUNNING_CRITICAL`, run other heavy apps | No crash; CLIP / voice reload when needed | 🤖 |
| M3 | Background then return | home button 30 min, come back | Same screen; access re-checked | 🤖 |
| M4 | Permission revoked while running | `pm revoke` photos | Clear note; no crash; prune doesn't wipe the index | 🤖 |
| M5 | Monkey test | `monkey -p com.pinpointer.app --throttle 200 5000` | No crash / ANR | 🤖 |
| M6 | ANRs | `dumpsys activity anr`, logcat | None during any section | 🤖 |
| M7 | Logs don't leak | grep logcat for full Aadhaar / PAN / phone numbers from the test files | None | 🤖 |
| M8 | Search history privacy gap | look at AsyncStorage search history | Known gap: still unmasked; recorded | 🤖 |
| M9 | Numbers past the mask | bench `privacy` after indexing your gallery (shapes only) | 0 stored texts with an unmasked Aadhaar or phone number | 🤖 |

## N. Photo look-alikes (CLIP): unrelated photos

The main worry: CLIP adding photos that have nothing to do with the search.
Every search on the phone records what the words found, what CLIP added, the
100 nearest photos with their distances, the far distance and the cutoff the
app used. `score.js` reports it under "Photo look-alikes (CLIP)". On your real
gallery, Claude looks at the photos (`device/sheet.js` makes one numbered sheet
per search) and records each one right or wrong (`device/judge.js`), so the
numbers come from your photos, not made-up ones.

| # | Check | How | Pass when | Who |
|---|---|---|---|---|
| N1 | Nonsense gets no photos | keyboard mash, "giraffe", emoji, single letters, 400 letters | 0 look-alikes added (the app's own measurement: 3 of 200 nonsense strings got one) | 🤖 |
| N2 | Paper searches aren't buried | names, numbers, "ramesh aadhaar", "bses bill", "pnr …" | CLIP never pushes the right paper down; no wrong look-alike in the top 3 | 🤖 |
| N3 | Paper searches get few photos | same searches | Look-alikes added per search, and how many are wrong (a paper search shouldn't bring ten random card-like photos) | 🤖 |
| N4 | Picture searches are right | dog, cat, car, cake, temple, flowers, food, beach, baby, selfie, mountain, bike, cow, elephant, wedding, birthday, festival lights | Of the look-alikes in the top 10, at least 8 right (judged on your photos) | 🤖 |
| N5 | Hindi and Hinglish picture words | कुत्ता, kutta, mandir, मंदिर, khana, phool, gaadi, शादी | Known words reach CLIP in English and work like N4; unknown Hindi is skipped (no look-alikes); unknown Hinglish ("kutta") sent to CLIP as-is: what comes back? | 🤖 |
| N6 | How many photos CLIP adds | every search | Look-alikes per search: median and max; searches that hit the 50 cap | 🤖 |
| N7 | The cutoff (`STAND_OUT_GAP` 0.12) | sweep 0.04–0.24 from the recorded distances | A value where N1 = 0 and N4 precision ≥ 80% with the most right photos kept; write it in `vectors.ts` | 🤖 |
| N8 | Your gallery's make-up | look at the far distance per search on your phone vs the test gallery | The 90th-percentile yardstick behaves on a gallery that is mostly screenshots / mostly people / mostly papers | 🤖 |
| N9 | Look-alikes of papers | "bill", "aadhaar card", "medicine" | CLIP adds photos of papers that are the right kind, not every white rectangle | 🤖 |
| N10 | People photos | "family photo", "baby", "selfie", Family tile | Group photos, not every photo with a person; Family tile count sensible | 🤖 |
| N11 | Festivals | "Diwali 2024", "holi photos" (CLIP sees "diwali lamps and lights") | Lights and colours photos lead; photos of papers from that week don't | 🤖 |
| N12 | Near-duplicates | 10 burst shots of one scene | Don't fill the whole top 10 | 🤖 |
| N13 | What CLIP is shown | `clipText` for every search | No filler ("ka", doubled "bill"), no names/numbers that only confuse it | 🤖 |
| N14 | Small gallery | phone with fewer than 20 photos | Fixed limit 1.26 behaves (no flood) | 🤖 |
| N15 | Merge order | word search with many matches | First 11 rows are word matches, then one look-alike per two words (RANK_K 10); check it reads well | 🤖 + 🖐 |
| N16 | Speed of the look-alike scan | 10,000 vectors | Scan time per search (ms) on your phone; typing stays smooth while it runs | 🤖 |
