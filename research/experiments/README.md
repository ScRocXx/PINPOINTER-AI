# Experiments

Research scripts, not app code: they are not part of `npx jest`, `tsc` or
`npm run lint`. They run the app's real search-key code
(`src/utils/TextEnrichment.ts`, `SearchKeys.ts`, `IndicText.ts`) and write
their numbers to `results/`.

| Script | Question | Result file |
|---|---|---|
| `ocr-misreads.exp.ts` | If OCR misreads one letter of a word, does search still find it? Today's matching vs shape key, query expansion, OCR-tolerant sound key, sound key within one edit, joined neighbours, and all combined. Also counts false matches against ~24,000 Hindi and 20,000 English words. | `results/ocr-misreads.json` |
| `typos.exp.ts` | If a person makes one typo (phone keyboard), does search still find the paper? Today vs correcting the query against the person's own indexed words. | `results/typos.json` |

## Run

```bash
python3 -m venv research/experiments/.venv
research/experiments/.venv/bin/pip install wordfreq
research/experiments/.venv/bin/python research/experiments/make-vocab.py   # writes data/vocab.json (not committed)

npx jest --testMatch '**/research/experiments/ocr-misreads.exp.ts'   # about 6 minutes
npx jest --testMatch '**/research/experiments/typos.exp.ts'          # about 4 minutes
```

`EXP_OUT=/some/file.json` writes the results elsewhere; `EXP_VOCAB` points at
another vocabulary file. Both scripts use a fixed random seed, so a rerun gives
the same numbers.

## What the simulation assumes

- OCR mistakes: one per word, kinds and rough weights from published
  Devanagari OCR studies (vowel signs, look-alike letters, marks, broken
  conjuncts, split words). They are not measured from ML Kit on phones yet:
  that is the next experiment, on real photos.
- The shape key and query expansion know the same confusion pairs the
  simulation uses, so their numbers are an upper bound for those mistakes.
- Typos: neighbouring key 40%, missed key 25%, extra key 20%, swapped keys 15%.
- The "person's index" is their document words plus common words, with
  wordfreq frequency standing in for how often each word appears.
