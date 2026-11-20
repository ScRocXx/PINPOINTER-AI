# Phone test report: <phone model>, <date>

Fill in **two copies** of this file as you go, and save after every part, so
nothing is lost if the session or the context runs out:

| | Private report | Repo report |
|---|---|---|
| Where | `tools/search-bench/private/reports/<YYYY-MM-DD>-<phone>.md` on the laptop (gitignored, never committed) | `tools/search-bench/reports/<YYYY-MM-DD>-<phone>.md`, committed on `smart-main` after each part |
| Holds | everything: real file names, names and words seen in the owner's photos, real searches and what they returned, links to sheets, screenshots and logs in `out/device/` and `private/` | the same structure and every number, with personal details replaced by descriptions ("a family photo", "an Aadhaar card", "a relative's name") |
| For | working from the laptop later: reproducing a problem on the owner's own photos | fixing the code anywhere |

Write the private report first, then the repo report from it. Screenshots
and sheets of personal content go in `tools/search-bench/private/` or
`out/device/`, never elsewhere in the repo. Before every commit, check the repo
report and `git diff` for names, numbers or addresses from the gallery.
Write for someone who wasn't there: a later session fixing these problems
starts from these files.

## 1. Setup

| | |
|---|---|
| Phone | model, Android version, RAM, free storage, CPU (`bench.js check` / `device.json`) |
| Laptop | OS, Node, adb version |
| App build | commit, APK file name and size, release + bench flag |
| Models in the APK | CLIP vision, CLIP text, vocab, Whisper, Hindi (sizes) |
| Owner's gallery | photos, screenshots, PDFs (counts only) |
| Test gallery | seed, sizes (`meta.json`), COCO photos used |
| Permissions | what was granted and how, what needed taps |
| Anything that went wrong while setting up | and how it was fixed (commits) |

## 2. Summary

- Five to ten lines: the biggest problems found, what works well, and whether
  it's ready for elderly users on 2–3 GB phones.
- A table of every checklist section: passed / failed / not run.

## 3. Indexing on the phone

- Owner's gallery and test gallery: time in total and per photo (p50 / p95),
  PDFs, and the CLIP backfill (`index-done.json`).
- Peak and typical memory (PSS), temperature and battery drain
  (`index-monitor.jsonl`), and any kill or ANR in logcat.
- Privacy: `privacy.json` (stored texts holding a number the mask missed, by
  shape).

## 4. Search accuracy

For the owner's gallery (`--set real`) and the test gallery, each with the
final list (words + CLIP) and the words-only list:

- The overall, by-kind and by-language tables from `results.report.md`, as
  they are.
- Phone vs desk (FINDINGS.md): which desk problems the phone confirms, which
  it doesn't, and which are new.
- Speed per search: words, typo rescue, CLIP encode, look-alike scan (p50 /
  p95).

## 5. CLIP look-alikes (section N, the main question)

- The CLIP table and the cutoff sweep from the report.
- **Recommended `STAND_OUT_GAP`**, and why (the table row).
- The searches with the most wrong look-alikes, with what they showed (in
  words) and the likely reason.
- How many sheets were judged, and how many verdicts.

## 6. Checklist results

Every CHECKLIST.md line, section by section:

| # | Result | What happened | Evidence |
|---|---|---|---|
| A1 | pass / fail / partly / not run (why) | one or two lines | file in out/device/…, logcat line, number |

## 7. Problems to fix

One block per problem, biggest first, so a later session can start from it:

```
### P1. <short title>
- Severity: privacy / crash / wrong results / slow / wording
- What happens: <steps and what the person sees>
- Evidence: <query ids, numbers, log lines, out/device/... files>
- Where in the code: <file:line, function>
- Suggested fix: <concrete>
- How to re-test: <exact bench command, query ids, checklist line>
```

## 8. Not tested, and why

## 9. Files

Where everything is on the laptop (`out/device/...`): results, reports,
monitor logs, sheets, judged.jsonl, privacy.json, logcat dumps. The restore
script and the night watch log from the laptop setup.
