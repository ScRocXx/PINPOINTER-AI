# What the desk bench found

Run on `smart-main` (2026-11-20): 10,000 test photos and PDFs, 644 searches,
the app's own indexing and search code on a real SQLite engine. OCR mistakes
are simulated and CLIP is not in this run, so these are the **words-only**
results: what the search screen shows first, before photo look-alikes arrive.
The phone bench will confirm them with real OCR and add CLIP.

## Overall

| | Right paper 1st | In top 3 | In top 10 | "Latest": right one 1st | Many answers: found in top 10 | Should find nothing: false alarms |
|---|---|---|---|---|---|---|
| All searches | 72.6% | 77.4% | 80.1% | 85% | 74.7% | 13 of 63 |
| English | 76.8% | 78.7% | 82.1% | 86.7% | 81.4% | |
| Hinglish | 69.0% | 93.1% | 93.1% | 75% | 49.7% | |
| Hindi | 46.7% | 53.3% | 53.3% | 100% | 45.0% | |
| Typed correctly (exact words) | 76.2% | 80.3% | 83.6% | 100% | 98.5% | |
| With one typo | 50.9% | 57.9% | 63.2% | 57.1% | 70.5% | |

No search failed or hung, including `"`, `*`, `NEAR(`, `'; DROP TABLE …` and
400-letter input. Words-only search took 1.8 ms typical, 11.5 ms at the 95th
percentile on this computer (a phone will be several times slower).

## Working well

- **"Latest" bills:** "latest electricity bill", "ramesh ka latest bijli bill",
  "सबसे नया बिजली बिल" put the right newest bill first in all 26 searches.
- **Words that are on the paper:** searches whose words are printed on the
  papers find 98.5% of them in the top 10.
- **Dates and festivals:** "Diwali 2024", "holi 2025", "eid 2025", "last month",
  "pichle mahine ka bill" find every photo from those days in the top 50.
- **Privacy:** none of the 204 Aadhaar, PAN and phone numbers on the test papers
  is stored, in the text or in the search index. Searching a full Aadhaar
  number finds nothing. Searching a full PAN finds that PAN card through its
  masked form, which helps and stores nothing.
- **WhatsApp copies** show once.

## Problems, biggest first

Each has the searches that show it; `inspect.bench.ts` shows why (see README).

1. **Papers don't print the word people search for, and every word must
   match.** A PAN card says "Permanent Account Number" and "आयकर विभाग", never
   "PAN". A voter ID says "Election Commission" and "निर्वाचक", never "voter".
   A wedding card never says "card". A boarding pass never says "ticket".
   - All 11 Hindi PAN and voter-ID searches found nothing ("रमेश का पैन कार्ड",
     "पूजा वोटर कार्ड"). This is most of the Hindi gap.
   - "wedding card", "shaadi ka card" and "flight ticket" find none of their
     papers.

   Ideas: concept words "आयकर", "income tax", "permanent account number" →
   pancard; "election", "elector", "निर्वाचन", "निर्वाचक" → voterid;
   "invitation", "weds", "शुभ विवाह" → wedding; "boarding pass" → ticket. Make
   "card / कार्ड / ticket / photo" optional when another word already names
   the kind of paper.

2. **Keyboard mash and absent words find things.** 9 of 15 keyboard-mash
   searches return papers ("jjjjjj" finds 49, "pqowie" 50), and so does
   "0000". "kangaroo" and "saxophone" find 14 and 25. The LIKE fallback matches a word's Soundex
   code as a substring anywhere in the hidden search tail: "jjjjjj" is J000,
   the code of "joy"; "pqowie" is P200, the code of "Pooja".

   Ideas: match Soundex codes only as whole tokens and only for word-like
   input, or drop the Soundex/LIKE step now that the typo rescue exists. Try
   each with the bench.

3. **That same fallback blocks the typo rescue.** A typo almost always "finds"
   something through Soundex or a sound key, so the rescue ("Showing results
   for …") never runs. "recyarge" shows a UPI payment and Hindi notices
   instead of the recharges. "ramesh asdhaar" shows a prescription instead of
   Aadhaar. One typo drops "right paper 1st" from 76% to 51%.

4. **The rescue only knows words printed in your papers.** It can't fix a
   typo in a word the papers never print: prescription (they print "Rx"),
   latest, pichla, kiraya, marksheet. "dr singh prescription anita" works;
   "dr singh presription anita" finds nothing. "latdst bijli bill" finds
   nothing.

   Idea: also correct towards the app's own search words (concepts,
   collection names, "latest" and date words, festival names).

5. **The rescue makes wrong corrections:**
   - "कुत्ता" (dog) became "खाता" (bank account): they share the sound key
     "kt".
   - "वेतन पर्ची" (salary slip) became "when राची".
   - "खून की जांच" (blood test) became "खूश की JAN", which the date reader
     then took as January.

   Ideas: never correct into another script, need a longer sound key for a
   sound correction, and never let a correction turn into a date.

6. **Short forwarded texts outrank the real thing.** Forwarded quotes ("Smile
   is the best medicine") and chats ("कल मंदिर चलेंगे") rank above medicine
   strips and temple photos. Short texts that say the word win the FTS rank;
   papers that only match through a concept ("Tablets" → medicine) rank lower.
   - "dawai": none of the medicine papers in the top 50.
   - **Medicine tile: 1 medicine paper in its first 50 results.** Home's tile
     would show quotes.
   - "मंदिर" and "khana": no labelled photos in the top 10.

   Ideas: rank a concept match on a document-like text above a literal word in
   a chat or quote (the classifier knows which is which). On a phone, CLIP may
   lift photos; the phone bench will show it.

7. **Sound keys join unrelated words.** "bima" (insurance) shows 30+ BHIM UPI
   screenshots before the LIC papers, because BHIM and बीमा share the sound
   key "bim".

   Ideas: no Hindi sound key for all-caps Latin brand names, or rank exact and
   concept matches above sound-only ones.

8. **Numbers people search for are masked as phone or Aadhaar numbers.** A
   10-digit PNR or consumer number starting with 6–9 is stored as a phone
   number ("******4195"). A 12-digit K No or account number is stored as an
   Aadhaar number ("****-****-8016").
   - None of the 5 PNRs that start with 6–9 is found by its number (the
     other 11 are).
   - 2 of the 8 bill account numbers are not found.

   Options (a privacy decision for you):
   - Don't mask a number right after a label (PNR, CA No, K No, Consumer No,
     Policy No).
   - Or store a one-way hash token of each masked number, so typing the whole
     number finds the paper. A 10-digit number's hash can be guessed by trying
     every number, so this protects less than masking.

9. **Common words the app doesn't know:**
   - "light bill" (what many people call the electricity bill).
   - "parchi / पर्ची" is read only as prescription, so "gas ki parchi" and
     "वेतन पर्ची" fail.
   - "kutta", "कुत्ता", "samundar", "pahad", "billi", "gaay".

   These go in `ConceptTable` (CLIP needs them in English too).

10. **Abbreviations:** SBI, PNB, BOB, MVVNL and JVVNL are not printed on the
    papers, so half of these searches miss. A small synonym list of Indian
    banks and power companies would fix it.

11. **"diwali photos" (every year)** lists the newest 100 photos from all the
    Diwali windows, so older Diwalis drop out: a third of the themed photos in
    the top 50.

12. **CLIP gets filler words:** "ramesh ka latest bijli bill" sends CLIP
    "ramesh ka electricity bill bill". Minor; the phone bench measures whether
    it matters.

## Not measured yet (needs the phone run)

- Real ML Kit OCR on tilted, blurred photos (Latin and Devanagari), instead of
  simulated misreadings.
- CLIP look-alikes, the biggest open question (CHECKLIST.md, section N):
  - how many unrelated photos CLIP adds to each search, judged on real photos;
  - whether they push the right paper down in paper searches;
  - "dog", "kutta", "family photo" and festival photos;
  - which `STAND_OUT_GAP` keeps nonsense out and real matches in, from the 100
    nearest distances recorded for every search.
- Speed, memory and heat on a 2–3 GB phone: indexing 10,000 photos, the CLIP
  scan over 10,000 vectors, voice.
