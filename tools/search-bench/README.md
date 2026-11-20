# Search bench

Measures how well Pinpointer **finds** things in a big gallery (10,000 photos
and PDFs), in English, Hindi and Hinglish, with typos, misread text, dates,
"latest", collections, photo look-alikes, and searches that should find
nothing. Two ways to run it, scored the same way:

| | Desk bench | Phone bench |
|---|---|---|
| Runs on | any computer, in seconds | your phone over USB, an hour or more |
| Search code | the app's own (`src/`), on a real SQLite engine | the app itself (bench build) |
| Text read from images | simulated OCR misreadings | real ML Kit OCR on drawn photos of papers |
| Photo look-alikes (CLIP) | no | yes, with the raw distances for tuning |
| Speed, memory, heat | desk speed only | the phone's |

Findings so far: [FINDINGS.md](FINDINGS.md). Next step, the phone run: [NEXT.md](NEXT.md). Everything else to check on a
phone, A to Z: [CHECKLIST.md](CHECKLIST.md).

## The test gallery (`corpus/generate.js`)

Made up, fixed by a seed (same command, same gallery): 8 families of monthly
electricity bills (English, Hindi, both), water and gas bills, Aadhaar (front
and back), PAN, voter ID, driving licence, ration card, passport,
prescriptions, medicine strips, lab reports, passbooks, 140 UPI screenshots,
bank SMS, salary slips, LIC receipts, marksheets, certificates, train tickets,
boarding passes, recharges, festival greetings and photos on the real festival
days, wedding cards, and the noise a real gallery has: about 700 chat
screenshots, 500 "good morning" quotes, news, shop boards, product labels,
notices, WhatsApp copies, and about 7,500 photos without text.

- **Screenshots** (about 1,340): UPI, chats (light and dark), SMS, recharges,
  e-tickets, Amazon orders, DigiLocker, the power company's app, YouTube,
  Hindi news, calendar, maps. Each is a 1080 × 2400 PNG in
  `Pictures/Screenshots` with the phone's status bar.
- **PDFs** (26):
  - e-bills;
  - 5-page bank statements, with test words low on page 1, at the top of page
    2 and on page 5;
  - an 8-page LIC policy;
  - Hindi notices;
  - scanned PDFs (only pictures inside);
  - UIDAI-style e-Aadhaar locked with a password;
  - PDFs in WhatsApp's Documents folder.
- **Photos without text**, with and without image labels, and searches for the
  placeholder the app stores for them. Names, numbers
and companies are invented; Aadhaar-shaped numbers fail the Aadhaar checksum,
so none is real.

About 640 searches come with it, each with its right answer: the paper asked
for, all papers that should come back, the newest one, or nothing at all.
Kinds: exact words, Hinglish, Hindi, across scripts, typos, cut-short words,
voice-style spelling, everyday sentences ("papa ki dawai ki parchi"), numbers,
abbreviations, "latest", dates and festivals, collections, what a photo shows,
words nothing contains, keyboard mash, emoji, FTS/SQL special characters, very
short and very long input, and full Aadhaar/PAN numbers (which must never be
findable).

## Desk bench (no phone)

```bash
cd tools/search-bench && npm install          # sqlite-vec (+ Playwright, only for the phone bench)
node corpus/generate.js                       # → out/corpus.jsonl, out/queries.jsonl
npm run desk                                  # indexes 10,000 items with src/ code, runs every search
node score.js out/desk-results.jsonl          # → out/desk-results.report.md
```

`desk/pdf.bench.ts` runs the app's own PDF reader (`processPDF`) on the
rendered PDFs (or any folder: `BENCH_PDFS=dir`) and reports, per PDF, whether
it was read as text or sent to OCR and how many of its words were kept.

`desk/nodeSqlite.js` stands in for op-sqlite with Node's built-in SQLite (FTS5,
fts5vocab) and the sqlite-vec extension, so the app's SQL, tokenizer and
ranking run for real (the Jest mock only imitates FTS5). `desk/desk.bench.ts`
indexes through `indexDocument` (masking, search keys, files table, copies'
fingerprints) and searches through `services/SearchPipeline.ts`, the same
functions the search screen calls. It also checks that no full Aadhaar, PAN or
phone number from the test papers was stored, including numbers where OCR
read a digit as a letter ("1O85"), which the mask misses. On a phone the same
check runs after indexing (`privacy.json`: shapes like "#### #### #O##" only,
no digits). To look closely at a few
searches:

```bash
BENCH_QUERIES='bijli bill|मंदिर|jjjjjj' npx jest --config tools/search-bench/jest.config.js --testMatch '**/inspect.bench.ts' --forceExit
cat tools/search-bench/out/inspect.txt
```

## Phone bench

Needs: a computer with Node and `adb` (Android platform-tools), the phone with
USB debugging on (Xiaomi/Redmi/POCO: also "Install via USB" and "USB debugging
(Security settings)"), about 1.5 GB free on the phone, the CLIP models in
`android/app/src/main/assets/models/clip/` (else photo search is off and the
picture searches score zero), and the Android build set up (JDK 17, SDK).

```bash
cd tools/search-bench && npm install && npx playwright install chromium
node device/bench.js prepare     # gallery + 1 GB COCO download + draws ~2,500 papers and screenshots
node device/bench.js build       # release APK with the bench switch on (put back after)
node device/bench.js install
node device/bench.js all         # check → push → grant → index → search → score
node device/bench.js clean       # take the test files off the phone afterwards
```

Results: `out/device/results.report.md` (the final list, words + CLIP) and
`results.words.report.md` (what shows first, words only), plus
`index-monitor.jsonl` (memory, temperature, battery every 30 s while indexing),
`index-done.json` (times and counts) and `device.json`.

How the phone side works: `src/bench/BenchRunner.ts` runs only in a build where
`src/bench/benchFlag.ts` says `BENCH_BUILD = true` (false in git; `bench.js
build` flips it for that one build and puts it back). It watches
`Android/data/com.pinpointer.app/files/bench/` for a request (`index`,
`search`), runs it with the app's own code, and writes results there. Results
name files ("d00042", or "own:IMG_1234.jpg" for your own photos), never their
text.

**Photos:** papers and screenshots are drawn by `device/render.js` (Playwright,
the app's Mukta font, tilted and blurred like phone photos, with the taken date
in EXIF). Photos without text are COCO val2017 images (cocodataset.org, CC BY
4.0); `device/photos.js` gives each one a slot and writes searches for what
they show ("dog", "kutta", "कुत्ता", "family photo" …) with COCO's own labels as
the right answers. COCO has 5,000, so the phone gallery is about 7,600 test
files; your own photos make up the rest.

**Judging CLIP on real photos:** the bench records what CLIP added to every
search and the 100 nearest photos with their distances. `device/sheet.js`
makes a numbered picture sheet per search (green = found by words, purple =
added by CLIP, dashed = nearest photos the cutoff left out); after looking,
`device/judge.js q00405 ok 1-6,9 wrong 7,8` records verdicts in
`judged.jsonl`, and `score.js` counts them. The report's CLIP section shows
how many photos CLIP adds, how many are wrong, whether they push the right
paper down, and what other `STAND_OUT_GAP` values would have kept. Searches on
your real gallery go in their own set: `out/device/real/queries.jsonl` (mode
`judge` when the right answers are only known by looking), then `node
device/bench.js search --set real`, `node device/sheet.js --set real --kind
picture`.

**Your own photos (optional):** list searches and their right answers by file
name in `out/device/own-queries.csv`, one per line:

```
meri bijli bill,IMG_20250312_101500.jpg
दादी की फोटो,IMG_1001.jpg;IMG_1002.jpg
```

Only file names are read; nothing about your photos leaves the phone except
which file names each search returned. Your photos in other results are left
out of the precision numbers (they may be right; the bench can't know).

## Scores (`score.js`)

| Search kind | Score |
|---|---|
| one paper asked for | 1st / top 3 / top 10 / found at all, mean reciprocal rank |
| "latest" | is the top result the right one |
| many right answers | recall in the top 10 and top 50, precision in the top 10 |
| nothing to find | false alarms |
| special characters, very short | must not fail; time |

A result that literally contains every word of the search counts as fine for
precision (a chat that says "bijli bill" is not wrong, just not the paper).
Copies count as their original. Dates like "kal" and "last month" are worked
out from when the run happened, in IST.
