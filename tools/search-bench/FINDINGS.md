# What the desk bench found

Run on `smart-main` (2026-11-20) over three made-up test galleries (seeds 7,
11 and 23), each with 10,000 photos and PDFs and about 690 searches. It uses
the app's own indexing and search code on a real SQLite engine. Ranges below
are the lowest and highest of the three galleries.

OCR is simulated and CLIP is not part of this run. So these are the
**words-only** results: what the search screen shows first, before photo
look-alikes arrive. The phone bench confirms them with real OCR and adds CLIP.

## Overall

| | Right paper 1st | In top 10 | "Latest": right one 1st | Many answers: found in top 10 | Should find nothing: false alarms |
|---|---|---|---|---|---|
| All searches | 64–69% | 75–78% | 85–91% | 70–73% | 18–20 of 66 |
| English | 67–72% | 76–80% | | | |
| Hinglish | 54–71% | 86–96% | | | |
| Hindi | 41–47% | 50–56% | | | |
| Exact words | 68–71% | 80% | 100% (26 of 26) | 99% | |
| One typo | 53–79% | 78–85% | | | |

No search failed or hung, including `"`, `*`, `NEAR(`, `'; DROP TABLE …` and
400-letter input. Words-only search took about 2 ms typical and 13–17 ms at
the 95th percentile on this computer; a phone will be several times slower.

## Working well

- **"Latest" bills.** "latest electricity bill", "ramesh ka latest bijli bill"
  and "सबसे नया बिजली बिल" put the right newest bill first in all 26 searches.
- **Words printed on the paper.** Many-answer searches whose words are on the
  papers find 99% of them in the top 10.
- **Dates and festivals.** "Diwali 2024", "holi 2025", "eid 2025", "last month"
  and "pichhle mahine ka bill" find every photo from those days in the top 50.
- **Scanned PDFs.** When OCR reads the page (simulated here), the right one
  comes 1st (4 of 4).
- **Screenshots of apps** whose words people type ("amazon order",
  "digilocker", "hanuman chalisa" in dark mode) are all found.
- **Photos without text** never showed up in searches for words, except
  through the placeholder (problem 8).
- **WhatsApp copies** show once.

## Problems, biggest first

Each is shown by the searches named; `inspect.bench.ts` shows why (README).

1. **Privacy: OCR slips let full numbers past the mask.** When OCR reads one
   digit as a letter ("1O85", "####l####"), the number no longer looks like
   an Aadhaar or phone number to `DataMasking`, so it is stored in full.
   - 3–10 of about 215 Aadhaar and phone numbers on the test papers were
     stored this way, depending on the gallery (`desk-index.json` →
     `privacy.storedWithOcrSlips`).
   - One was a full Aadhaar number: "4746 9769 1O85". Searching
     "4746 9769 1085" then found that card, because the typo fixer
     "corrected" 1085 to 1O85.

   Idea: before masking, read O/o/D/Q as 0, l/I/i/| as 1, S as 5, B as 8 and
   Z as 2 inside runs that are mostly digits. Then mask, as today.

2. **The PDF text reader reads only old, uncompressed PDFs.**
   `DocumentPipeline.extractNativeText` looks for text in the raw file bytes.
   Nearly every PDF today is compressed, so it reads nothing and every PDF
   goes to OCR of pictures of its pages. That covers the English e-bill, the
   Hindi notice, the 5-page bank statement and the 8-page LIC policy
   (`pdf.bench.ts`: 26 of 26 PDFs went to OCR; a hand-written uncompressed
   PDF was read in full). On a phone this means:
   - slower indexing;
   - OCR mistakes on perfectly clean documents;
   - **only the first 500 characters of pages 1–3** are kept.

   In the statements, a shop at the top of page 2 is found (4 of 4). A shop
   lower on page 1 is found only by luck (1 of 4, through the loose fallback).
   One on page 5 is never found (0 of 4).

   Ideas: read PDF text with Android's own PDF support or a small text
   extractor, keep more text per page for digital PDFs, and index later pages
   in the charging-time job.

3. **Locked and WhatsApp PDFs are invisible.**
   - UIDAI's e-Aadhaar PDF is password-protected (first 4 letters of the name
     + birth year). The app can't open it, so only its file name is stored.
     "deepak e aadhaar" finds neither the PDF nor the card.
   - PDFs received on WhatsApp sit in
     `Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents`. PDF sync
     looks only in Download, Documents and picked folders, so all 3 WhatsApp
     PDF searches find nothing.

   Ideas: ask once for an e-Aadhaar's password (or index it by its name as
   "Aadhaar"); add WhatsApp's Documents folder to the PDF crawl when All
   Files Access is on.

4. **Papers don't print the word people search for, and every word must
   match.** A PAN card says "Permanent Account Number" and "आयकर विभाग", never
   "PAN". A voter ID says "Election Commission" and "निर्वाचक", never "voter".
   Wedding cards never say "card"; boarding passes never say "ticket"; PDFs
   never contain the word "pdf".
   - All 11 Hindi PAN and voter-ID searches find nothing ("रमेश का पैन कार्ड",
     "पूजा वोटर कार्ड"). This is most of the Hindi gap.
   - "wedding card", "shaadi ka card", "flight ticket" and "BSES bill pdf
     september 2026" miss their papers.

   Ideas: concept words "आयकर", "income tax", "permanent account number" →
   pancard; "election", "elector", "निर्वाचन", "निर्वाचक" → voterid;
   "invitation", "weds", "शुभ विवाह" → wedding; "boarding pass" → ticket.
   Treat "card / कार्ड / ticket / pdf / photo" as optional, or as a filter
   ("pdf" = Papers), when another word already names the thing.

5. **Two-sided cards.** An Aadhaar is two photos. The name is on the front;
   "UIDAI" and often the only readable "आधार" are on the back. When OCR misses
   the front's "मेरा आधार" line, no single photo has both "deepak" and
   "aadhaar", and "Deepak aadhaar" finds neither side.

   Idea: link the two sides by the last 4 digits they share, or tag a card
   as Aadhaar from its layout ("Government of India" + a 12-digit number).

6. **Keyboard mash and absent words find things.**
   - 9 of 15 keyboard-mash searches return papers ("jjjjjj", "pqowie" and
     others find 50), and so does "0000".
   - "saxophone", "kangaroo" and "igloo" find 18, 14 and 4.

   The fallback matches a word's Soundex code as a substring anywhere in the
   hidden search tail: "jjjjjj" is J000, the code of "joy"; "pqowie" is P200,
   the code of "Pooja".

   Ideas: whole-token Soundex only, only for word-like input, or drop the
   Soundex/LIKE step now that the typo rescue exists. Try each with the
   bench.

7. **The typo rescue is blocked, limited and sometimes wrong.**
   - *Blocked:* a typo almost always "finds" something through the fallback
     above, so the rescue never runs. "recyarge" shows a payment and notices;
     "ramesh asdhaar" shows a prescription.
   - *Limited:* it only corrects towards words printed in your papers, so
     typos of prescription, latest, pichla, kiraya and marksheet can't be
     fixed. "dr singh presription anita" finds nothing; spelled right it
     finds 3 prescriptions.
   - *Wrong* (in at least two of the three galleries):
     - "कुत्ता" (dog) became "खाता" (bank account), the same sound key;
     - "वेतन पर्ची" became "when सच्ची";
     - "खून की जांच" became "खान की JAN", which is then read as January.

   Ideas: never correct into another script, need a longer sound key, never
   let a correction become a date, and also correct towards the app's own
   words (concepts, collections, "latest" words, festivals).

8. **The placeholder for photos without text is searchable.** Photos without
   text are stored as the word "image", so "image", "img" and even "imag"
   list 50 random photos. Typing "im…" on the way to "imran" shows them too.
   Idea: store an empty text (or a hidden token) instead of "image".

9. **Short forwarded texts outrank the real thing.** Forwarded quotes ("Smile
   is the best medicine") and chats ("कल मंदिर चलेंगे") rank above medicine
   strips and temple photos.
   - "dawai": none of the medicine papers in the top 50.
   - **Medicine tile:** 2 medicine papers in its first 50 results, so Home's
     tile would show quotes.
   - "मंदिर" and "khana": no labelled photos in the top 10.

   Idea: rank a concept match on a document-like text above a literal word in
   a chat or quote. The phone bench shows whether CLIP lifts the photos.

10. **"Screenshots" as a typed search doesn't use the Screenshots album.**
    The Home tile reads the album, but typing "Screenshots", "screenshot" or
    "स्क्रीन शॉट" searches words: 3, 3 and 0 results out of 1,340 screenshots.
    "payment screenshot" and "whatsapp chat" find nothing, because no
    screenshot says "screenshot" or "WhatsApp". On a phone, CLIP's "a
    screenshot of a phone screen" may help: measure it there.

11. **Sound keys join unrelated words.** "bima" (insurance) shows more than 30
    BHIM UPI screenshots before the LIC papers, because BHIM and बीमा share
    the sound key "bim".

12. **Numbers people search for are masked.** A 10-digit PNR or consumer
    number starting with 6–9 is stored as if it were a phone number; a
    12-digit account or K number as if it were an Aadhaar.
    - None of the 7 PNRs that start with 6–9 is found by its number (all 9
      others are).
    - 2 of 8 bill account numbers aren't found.

    A privacy decision: don't mask a number right after a label (PNR, CA No,
    K No, Consumer No), or store a one-way hash of each masked number (weaker
    for 10 digits, which can be guessed).

13. **Common words the app doesn't know:**
    - "light bill";
    - "parchi / पर्ची" is read only as prescription, so "gas ki parchi" and
      "वेतन पर्ची" fail;
    - "kutta", "कुत्ता", "samundar", "pahad", "billi", "gaay";
    - "house tax" for "गृहकर".

    These go in `ConceptTable` (CLIP needs them in English too).

14. **Abbreviations:** SBI, PNB, BOB, MVVNL and JVVNL aren't printed on the
    papers. A third of these searches miss.

15. **"diwali photos" (every year)** lists the newest 100 photos from all the
    Diwali windows: a third of the themed photos make the top 50.

16. **CLIP gets filler words:** "ramesh ka latest bijli bill" sends CLIP
    "ramesh ka electricity bill bill".

## Not measured yet (needs the phone run)

- Real ML Kit OCR on tilted, blurred photos, PNG screenshots (light and dark),
  and scanned and digital PDF pages, instead of simulated misreadings. This
  includes how often digits really come out as letters (problem 1).
- CLIP look-alikes, the biggest open question (CHECKLIST.md, section N):
  - how many unrelated photos CLIP adds to each search, judged on real photos;
  - whether they push the right paper down;
  - "dog", "kutta", "family photo", festivals, "Screenshots";
  - which `STAND_OUT_GAP` keeps nonsense out, from the 100 nearest distances
    recorded per search.
- Speed, memory and heat on a 2–3 GB phone: indexing 10,000 photos and PDFs
  (OCR of every PDF page), the CLIP scan over 10,000 vectors, voice.
