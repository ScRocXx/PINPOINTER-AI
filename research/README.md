# Branch `feat/smart-search`: what changes from `fix/low-end-smoothness`

`fix/low-end-smoothness` made the app smooth on 2–3 GB phones (fewer
re-renders, indexing that steps aside while you use the phone, photo search off
the JS thread, the CLIP text model loaded only for search).

This branch works on what makes Pinpointer different: **finding the words in
your papers and photos**, in Hindi, Hinglish and English, for people who type
slowly and make mistakes, from text that OCR doesn't always read right.

The research behind it is in [`notes.md`](notes.md); the experiments that
measured the problem are in [`experiments/`](experiments/README.md). In short,
with the search as it is on `fix/low-end-smoothness`:

- one OCR misreading in a Hindi word leaves it findable only about **47%** of
  the time, and in an English word only about **2%** ("rnedicine", "bi11");
- one typo in the search box finds the intended paper only **22–31%** of the
  time.

This file is updated as each part lands. Status: **planned**, **in progress**,
**done** (with tests), **on a phone** (checked on a real device).

| # | Change | What people notice | Status |
|---|---|---|---|
| 1 | Misread-proof search | Papers are found even when OCR misread a letter or split a word | **done** |
| 2 | Spelling rescue from your own words | "bijki bil" or "medicne" still finds the paper, with "Showing results for …" | **done** |
| 3 | Memory anchors: dates and festivals | "Diwali photos", "papers from last month", "kal ki photo" | **done** |
| 4 | Answer cards | A bill result shows "₹1,240 · due 5 April" without opening it | planned |
| 5 | Words-first photo reader (native) | Indexing reads each photo once; screenshots' small text stays readable | planned |
| 6 | Hindi voice tuned to your words (native) | Speak in Hindi; names and medicine words in your papers are understood | planned |
| 7 | Series and duplicates | WhatsApp copies read once; "latest electricity bill" | planned |

## 1. Misread-proof search (done)

**What people notice.** A paper is found even when OCR misread a letter
("rnedicine", "मुगतान" for भुगतान, "बजली" for बिजली) or split a word in two
("elec tricity"). Exact matches still come first; papers found through a
misreading come after them, with the misread word marked.

**How.** `src/utils/OcrTolerance.ts` adds three hidden keys per word to the
search tail (`SearchKeys.buildSearchTail`):

- `qv…` shape key: how the word looks. Letters OCR confuses become one (ब/व,
  म/भ, घ/ध/द, त/ट, ष/प, थ/य, vowel lengths; 1/l/i, 0/o, 5/s, rn/m, cl/d, vv/w),
  and the marks OCR drops are left out (nukta, halant, anusvara,
  chandrabindu). A query also looks for its shape with each vowel sign left
  out.
- `qf…` folded sound key, for Indian-script words: the sound key with b/v/m,
  g/d and a nasal before a consonant folded. It works across scripts, so a
  query typed in Hinglish ("bhugtan") finds a misread Hindi word.
- `qj…` joined neighbours: the sound key of two neighbouring words joined,
  when one is short (4 letters or fewer) and neither is a very common word.

`src/database/search.ts` runs the misread pass only to add results after the
exact ones (`searchMisread`), collections ("Medicine") included.
`MatchTerms.matchTermsIn` marks the misread word when nothing matched
outright. `SEARCH_KEYS_VERSION` in `SearchKeys.ts` is now 2.

**Existing indexes.** A new background job, `rekey` in `IndexingService`
(`src/utils/SearchRekey.ts`), rebuilds the tail of older rows from their
stored (already masked) text: no file is read again. 25 rows per
transaction, waits while someone uses the phone, resumes from where it
stopped. It runs 5 s after start (before the CLIP backfill) and in the
charging-time job.

**Measured** with the shipped code (`research/experiments/app-search.exp.ts`,
same simulated misreadings as experiment 1):

| A misread word, searched by… | Before | Now |
|---|---|---|
| Hindi, typed in Hindi | 47% found | 99% |
| Hindi, typed in Hinglish | 47% | 62% |
| English | 2% | 78% |
| Other real words a query also finds (Hindi / English) | 6.4 / 3.5 | 7.8 / 3.7 |

**Cost.** Each row's stored text grows about 1.6x (Hindi 1.66x, English
1.56x; it was 1.8–2.1x before trimming the joins and the English keys). The
search itself adds one more FTS query, run only to fill the results after the
exact matches.

**Known limits, and what refines them next**

- The misreadings are simulated from published Devanagari OCR studies, not
  measured from ML Kit. Next: collect real misreadings (render known words
  into images and read them back with ML Kit on a phone; and count a result
  opened from the misread pass as a confirmed misreading).
- English: e/c and h/b are not folded, and words under 4 letters get no
  shape key, to keep the index small (that is most of the 99% → 78% gap
  against experiment 1).
- Joined neighbours are restricted by word length; with OCR's word positions
  (part 5) only words that sit unusually close need joining, which is both
  smaller and more accurate.
- Hinglish typing against a misread Hindi word stays the hard case (62%);
  part 2 (spelling rescue) helps from the query side.

## 2. Spelling rescue (done)

**What people notice.** A search with a typo ("medicne", "bijki bil") shows
the papers anyway, with "Showing results for “medicine”" and, smaller, "You
typed “medicne”". Correct searches are never touched.

**How.** When the typed words find nothing,
`services/SpellingService.rescueQuery` corrects each word that isn't in the
index against the person's own words, not a generic dictionary (which knows
neither "Telmisartan", nor the shop's name, nor "bijlee"):

- `database/vocabulary.ts` reads the index's words with SQLite's
  `fts5vocab`, as a TEMP table on the read connection (no schema change; the
  scan runs on op-sqlite's thread). Up to 40,000 terms, most common first,
  kept in memory while searches happen and freed after 10 idle minutes.
- `utils/SpellingRescue.ts` finds the correction two ways: **spelling** (an
  indexed word within 1 edit for words up to 4 letters, 2 for longer, same
  script) and **sound** (an indexed Bhasha sound key within 1 edit of the
  word's key; the word is then looked up in a row that holds that key). Sound
  is what turns "bijki" into बिजली.
- `useSearch` searches the corrected query, uses it for the CLIP step too,
  and exposes `correctedFrom`; `SearchOverlay` shows the line.

**Measured** with the shipped code (`research/experiments/app-typos.exp.ts`,
same typos as experiment 2, policy as shipped: correct only when nothing is
found):

| One typo in the search box | Before | Now |
|---|---|---|
| Hinglish, index of 2k / 10k words | 28% / 31% found | 92% / 84% |
| English, index of 2k / 10k words | 24% / 22% | 97% / 92% |
| Correct queries "corrected" | | 0 of 121 |

**Known limits, and what refines them next**

- A typo that happens to match some other paper ("bil" → "bilkul") shows
  those results and is not corrected; that is most of the remaining gap
  (experiment 2 reached 99–100% with the top three suggestions). Next: a
  "Did you mean …?" chip when a typed word is not in the vocabulary, shown
  without replacing the results (only once the person stops typing, since a
  half-typed word is not a typo).
- The typos are simulated (neighbouring, missed, extra and swapped keys), not
  collected from elderly users yet.

## 3. Memory anchors (done)

**What people notice.** "Diwali photos", "दिवाली 2022", "pichhli rakhi",
"kal ki photo", "pichhle mahine ka bill", "march 2024 bill", "2023 photos"
all work. The results say when they are from ("When: Diwali, every year",
"कब: पिछले महीने"). A date alone lists everything from those days, newest
first; other words are looked for only within those days. For a festival,
photos that look like it (CLIP: "diwali lamps and lights") rise to the top.

**How.**

- **When a photo was taken** is stored now (`document_index.taken_at`,
  migration 3, with an index). Photos get the gallery's taken time; PDFs their
  file date. Rows indexed before get the file time sync had recorded.
- **`utils/DateQuery.ts`** reads the date words (English, Hinglish, Hindi):
  today/aaj, kal, parso, this/last week, month and year, month names (March
  and May only next to a year), years (alone only, so "bill 2023" still means
  the words), and 15 festivals.
- **Festivals are computed, not listed**, so the app never goes out of date:
  - Moon phases: Meeus' algorithm (ch. 49).
  - Hindu months: the lunar month is named by the sun's sidereal sign at its
    new moon, worked out at that moment (Meeus ch. 25 minus the Lahiri
    ayanamsa).
  - The extra (adhik) months of 2020 and 2023: the last new moon in the sign
    counts.
  - Eid and Bakrid: the arithmetic Islamic calendar, a day wider.
  - Tested against the real festival days of 2016–2025: Diwali, Holi, Raksha
    Bandhan, Ganesh Chaturthi, Navratri, Dussehra, Karva Chauth, Chhath, Eid
    and Bakrid all land inside their windows every year.
- **`database/search.ts`**: `listByDate` (uses the index) for a date alone;
  word and look-alike results filtered to the windows otherwise.
  `useSearch` exposes `dateMeaning` and skips spelling rescue for dates
  (nothing from then is not a typo).

**Known limits, and what refines them next**

- Photos and papers not indexed yet don't show in date searches; the Photos
  tab's own date chips still show every photo. Next: fill a date search from
  the phone's gallery (MediaStore can filter by date) when the index has few.
- Festivals use Indian dates and IST; regional festivals beyond these 15 (Onam,
  Pongal's days, Bihu, Durga Puja's days) are next, each tested like these.
- "kal" is read as yesterday (nobody searches tomorrow's photos).

## 4. Answer cards (planned)

Amounts, due dates, expiry dates and medicine times are read from the stored
text with rules (no extra model) and shown in the result row.

## 5–7 (planned)

Native work, described in [`notes.md`](notes.md). They need an Android build
and a phone to prove, so they come after 1–4.

## What stays the same

- Everything still runs offline, on the phone.
- Personal numbers are still masked before anything is stored.
- Word matches still rank above photo look-alikes.
