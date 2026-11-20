# Pinpointer: research notes, experiments and new ideas

Written 14 Nov 2026. Experiments ran in Jest with the app's real search-key code
(`buildIndexableContent`, `withSearchTail`, `termsForQueryWord`, `bhashaKey`,
`romanize`); only the FTS5 matching rule was re-implemented (prefix on the word
and its romanized form, exact on sound keys and concept ids). Code and raw
results: `experiments/` (see `experiments/README.md` to run them again; both
are deterministic, a rerun gives the same numbers).

Most papers could not be opened from the build environment (arxiv.org and
several university sites were unreachable), so findings marked "literature"
come from search-result summaries, plus the ML Kit, sherpa-onnx and model-card
pages that could be read directly.

## Experiment 1: does search survive OCR mistakes?

Setup
- Targets: 117 Hindi and 69 English words common on Indian documents, plus
  1,463 ordinary Hindi words (wordfreq, ranks 150-1650).
- One simulated OCR mistake per word. Kinds and rough weights from the
  literature: vowel signs 26%, other marks (anusvara, chandrabindu, nukta) 18%,
  look-alike letters 41% (MOCR 2017 breakdown); look-alike pairs ba/va,
  gha/dha, ma/bha, da/dha, ta/Ta (2026 Devanagari OCR benchmark), plus pa/sha,
  tha/ya (assumed); dropped halant (broken conjuncts); a word split in two; and
  kha read as ra+va (a classic misread, used as an "unknown" error the
  expansion method doesn't know).
- English: rn/m, cl/d, vv/w, l/1, i/l, o/0, e/c, s/5, h/b, and splits.
- False matches: how many of 23,914 other real Hindi words (20,000 English)
  each document-word query also finds.

Recall (Hindi document words; overall weighted by the literature mix)

| Method | Vowel sign | Look-alike | Marks | Halant | Split | ra+va | Overall |
|---|---|---|---|---|---|---|---|
| Today | 78% | 24% | 48% | 100% | 0% | 0% | ~47% |
| Shape key | 79% | 98% | 100% | 100% | 0% | 100% | |
| Query expansion | 100% | 100% | 100% | 100% | 0% | 0% | |
| OCR-tolerant sound key | 78% | 61% | 80% | 100% | 0% | 0% | |
| All combined + joined neighbours | 100% | 100% | 100% | 100% | 100% | 100% | 100% |

- Hinglish-typed queries: today ~47%, combined ~60%, sound key within one edit
  ~83% (but 47 false matches per query, so only as a fallback tier).
- English document words: today 2% (one misread letter almost always loses
  the word), combined 100%.
- False matches per query: today 6.4 (Hindi) / 3.5 (English); combined 7.6 /
  5.7; sound key within one edit 47 / 17. Joining neighbours: 0.003 false
  matches per 1,000 documents per query.

Caveats: the error mix is simulated from published categories, not measured
from ML Kit on phones; one error per word; the shape key and expansion know the
same confusion pairs the generator used, so their numbers are an upper bound
for errors of those kinds.

## Experiment 2: typos in typed queries

Setup: phone-keyboard typos (neighbouring key 40%, missed key 25%, extra key
20%, swapped keys 15%) on English words and on Hindi document words typed in
Hinglish. The person's index: their document words plus 2,000 or 10,000 other
words (wordfreq frequency as a stand-in for how often each word occurs).

| | Today | Fix: top suggestion | Fix: top 3 | Fix only when nothing is found |
|---|---|---|---|---|
| Hinglish, 2k words | 28% | 99% | 100% | 94% |
| English, 2k words | 24% | 100% | 100% | 98% |
| Hinglish, 10k words | 31% | 96% | 99% | 88% |
| English, 10k words | 22% | 97% | 100% | 94% |

- Correct queries never found nothing, so the fix never fired on them (0/121).
- A plain scan took 23 ms (2k words) and 137 ms (10k words) per query in
  Node; a phone is slower, so use a precomputed delete index (SymSpell).

## Ideas, ranked

1. Misread-proof search: shape key + confusion expansion + OCR-tolerant sound
   key + joined neighbours, gated by ML Kit's per-word confidence; exact matches
   first, "maybe misread" matches after. Learn the confusion table from ML Kit
   itself (rendered text, and results people open from the "maybe" tier).
2. Spelling rescue from the person's own words: fts5vocab gives the index
   vocabulary; a SymSpell delete table in SQLite makes lookups instant; sound
   keys cover spelling variation, edits cover typos.
3. Hindi voice tuned to the person's own words: a 28 MB streaming Hindi
   transducer (indic-lekhan) instead of the 160 MB English-only Whisper, with
   sherpa-onnx hotwords built from the index vocabulary; English words spoken
   in Hindi come out in Devanagari and the existing cross-script sound keys
   match them.
4. Words-first pipeline: decode once, OCR every photo, order by likely text,
   keep screenshot text readable, one OCR pass where Devanagari also reads
   Latin (ML Kit's API reference says it does), confidence per word.
5. Answer cards read aloud: amounts, due dates, expiry dates, medicine times
   from OCR boxes + rules; spoken with Android's offline Hindi TTS.
6. Memory anchors: festivals (precomputed lunisolar dates), events (time-gap
   clusters), source folders (WhatsApp, Camera, Downloads).
7. Series and duplicates: exact duplicates by size + hash; recurring bills by
   MinHash of their text, giving "latest electricity bill".
8. Find by number without storing it: keyed hash (Android Keystore) of full
   ID numbers next to the masked text.

## Sources

- Devanagari OCR errors: https://arxiv.org/pdf/2606.29213 ,
  https://web.iitd.ac.in/~sumeet/MOCR_2017_paper_8.pdf ,
  https://arxiv.org/html/2412.15248v1 (RoundTripOCR), https://arxiv.org/pdf/2609.21595
- OCR-noise retrieval: https://typeset.io/pdf/information-retrieval-based-on-ocr-errors-in-scanned-3ctjoiibt3.pdf ,
  https://typeset.io/pdf/probabilistic-retrieval-of-ocr-degraded-text-using-n-grams-5ampj1tfkw.pdf ,
  https://doras.dcu.ie/16282
- ML Kit: https://developers.google.com/ml-kit/reference/swift/mlkittextrecognitiondevanagari/api/reference/Classes/DevanagariTextRecognizerOptions ,
  https://developers.google.com/android/reference/com/google/mlkit/vision/text/Text.Element
- Speech: https://huggingface.co/Henil1/indic-lekhan ,
  https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/hotwords/index.rst ,
  https://arxiv.org/pdf/2306.01942 , https://arxiv.org/html/2508.17796v1 ,
  https://arxiv.org/pdf/2305.15386
- Text presence: https://openresearch.surrey.ac.uk/permalink/44SUR_INST/15d8lgh/alma99822313002346
- Spelling: https://github.com/wolfgarbe/symspell
- Hindi time expressions: https://ir.daiict.ac.in/entities/publication/70af824b-ac4e-4074-b76b-948faa3cf81f/full
- Duplicates: https://sites.cs.ucsb.edu/~tyang_class/293s22f/slides/TopicDuplicate1.pdf
- CLIP binarization: https://marqo.ai/blog/learn-to-binarize-clip-for-multimodal-retrieval-and-ranking
- Older users: https://www.outlookmoney.com/news/digital-divide-among-elderly-66-find-digital-tools-too-confusing ,
  https://openaccess.cms-conferences.org/publications/book/978-1-4951-2109-8/article/978-1-4951-2109-8_11
