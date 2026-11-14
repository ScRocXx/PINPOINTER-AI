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
| 1 | Misread-proof search | Papers are found even when OCR misread a letter or split a word | planned |
| 2 | Spelling rescue from your own words | "bijlee bil" or "medicne" still finds the paper, with "Showing results for …" | planned |
| 3 | Memory anchors: dates and festivals | "Diwali photos", "papers from last month", "kal ki photo" | planned |
| 4 | Answer cards | A bill result shows "₹1,240 · due 5 April" without opening it | planned |
| 5 | Words-first photo reader (native) | Indexing reads each photo once; screenshots' small text stays readable | planned |
| 6 | Hindi voice tuned to your words (native) | Speak in Hindi; names and medicine words in your papers are understood | planned |
| 7 | Series and duplicates | WhatsApp copies read once; "latest electricity bill" | planned |

## 1. Misread-proof search (planned)

Each word in a paper is stored with extra hidden keys besides its sound key:
how it **looks** (letters OCR confuses, such as ब/व, म/भ, rn/m, l/1, count as
the same), an OCR-tolerant sound key that works across scripts, and joined
neighbouring words (OCR sometimes splits one word in two). A search finds exact
matches first and possible misreadings after them, so precision stays where it
was. Existing indexes get the new keys gradually, in the background.

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
