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
| 2 | Spelling rescue from your own words | "bijlee bil" or "medicne" still finds the paper, with "Showing results for …" | planned |
| 3 | Memory anchors: dates and festivals | "Diwali photos", "papers from last month", "kal ki photo" | planned |
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

## 2. Spelling rescue (planned)

When a typed word finds nothing, it is corrected against the words that are
actually in your papers (SQLite lists them for free), not a generic dictionary.
Sound keys already cover spelling variation; this adds typos.

## 3. Memory anchors (planned)

The date a photo was taken is stored (today only the indexing time is). Search
understands "today", "kal", "last month", "2023", and festivals (Diwali, Holi,
Eid, Christmas and others) from a small table of their dates.

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
