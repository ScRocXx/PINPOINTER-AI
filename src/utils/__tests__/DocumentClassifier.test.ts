/**
 * Unit tests for src/utils/DocumentClassifier.ts
 *
 * Source behavior (verified by reading the module — pure logic, no imports):
 *
 * classifyDocument(content, fileName?):
 * - 18 keyword rules; each needs >= 1 keyword hit to be considered.
 * - confidence = min((keywordHits / keywords.length) * 70, 70)
 *   + min((boostHits / boostKeywords.length) * 30, 30), rounded.
 * - A SINGLE keyword hit is capped at 20 (below the 30 threshold), so casual
 *   mentions ("submit your Aadhaar") do NOT classify.
 * - MIN_CLASSIFICATION_CONFIDENCE = 30 (strictly < 30 fails).
 * - Ties are broken by RULES array order (strict `>` keeps the earlier rule).
 * - If content confidence < 30 and a fileName is given, FILENAME_PATTERNS are
 *   tried in order; first match wins with confidence 45.
 * - Second pass (only when still < 30): education multi-signal scorer needs
 *   score >= 40 -> EDUCATION, confidence min(score, 85).
 * - Otherwise GENERAL_DOCUMENT with whatever low confidence was found.
 * - Matching is case-insensitive SUBSTRING matching (lowercased content).
 *   Consequence: single/2-letter keywords like 'vi' (phone bill) match inside
 *   words like "review"/"provision"; '_' counts as a word char, so
 *   /\bresume\b/ does NOT match "resume_2024.pdf".
 *
 * extractSmartTitle(content, fileName, classification):
 * - Strips a trailing .pdf (case-insensitive) and trims.
 * - Generic names (/^(scan|download|img|image|doc\d|whatsapp|wa\d+)/i):
 *     - if confidence > 40 AND category != GENERAL_DOCUMENT: try
 *       extractIdentifier(); on success return "<label> — <identifier>".
 *     - else if content.length > 5: return first line with 8 < len < 60.
 * - Non-generic names: returned as-is (cleaned).
 * - "" filename -> 'Untitled Document'.
 * - extractIdentifier: BANK_STATEMENT -> bank name (uppercased);
 *   AADHAAR_CARD -> "****-****-<last4>" from \d{4}\s?\d{4}\s?\d{4};
 *   INVOICE -> "#<match>" from /(?:invoice|inv)[\s#:]*([A-Z0-9-]+)/i;
 *   SALARY_SLIP -> "<Month> <YYYY>"; others -> null.
 */

import {
    ClassificationResult,
    classifyDocument,
    extractSmartTitle,
} from '../DocumentClassifier';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A weak/generic content string that matches no rule and no education signal. */
const WEAK = 'some scanned document pages with no keywords';

/** Fabricate a classification result (for extractSmartTitle boundary tests). */
const fakeClassification = (
    category: ClassificationResult['category'],
    label: string,
    confidence: number,
): ClassificationResult => ({
    category,
    emoji: '🧾',
    label,
    confidence,
});

// ═══════════════════════════════════════════════════════════════════════════
// classifyDocument — every supported category (obvious + tricky)
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyDocument — AADHAAR_CARD', () => {
    const obvious = [
        'GOVERNMENT OF INDIA',
        'Unique Identification Authority of India',
        'AADHAAR',
        'Enrolment No: 1234/56789/01234',
        'Name: RAJESH KUMAR',
        'DOB: 15/08/1990',
    ].join('\n');

    test('classifies a full Aadhaar card (3 keyword hits + 2 boosts = 47)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('AADHAAR_CARD');
        expect(r.emoji).toBe('🪪');
        expect(r.label).toBe('Aadhaar Card');
        expect(r.confidence).toBe(47);
    });

    test('casual mention ("submit your aadhaar") stays GENERAL — single hit capped below threshold', () => {
        const r = classifyDocument('Please submit your aadhaar card photocopy for verification.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBeLessThan(30);
    });
});

describe('classifyDocument — PAN_CARD', () => {
    const obvious = [
        'INCOME TAX DEPARTMENT',
        'GOVT OF INDIA',
        'Permanent Account Number Card',
        'ABCDE1234F',
        "Name: PRIYA SHARMA",
        "Father's Name: RAMESH SHARMA",
    ].join('\n');

    test('classifies a PAN card (2 keyword hits + 2 boosts = 55)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('PAN_CARD');
        expect(r.label).toBe('PAN Card');
        expect(r.confidence).toBe(55);
    });

    test('single "income tax" mention does not classify (needs >= 2 hits)', () => {
        const r = classifyDocument('Pay your income tax online before the due date.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBeLessThan(30);
    });

    test('a bare PAN number alone does not classify', () => {
        const r = classifyDocument('PAN ABCDE1234F');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — VOTER_ID', () => {
    const obvious = [
        'ELECTION COMMISSION OF INDIA',
        'Electors Photo Identity Card',
        'EPIC No: ABC1234567',
        'Name: VIKAS GUPTA',
        'Constituency: Delhi Cantt',
        'Polling Station: 42',
    ].join('\n');

    test('classifies a voter ID (3 keyword hits + 2 boosts = 62)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('VOTER_ID');
        expect(r.confidence).toBe(62);
    });

    test('"voter turnout" news text stays GENERAL', () => {
        const r = classifyDocument('Voter turnout was 65% in the last election.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — DRIVING_LICENSE', () => {
    const obvious = [
        'DRIVING LICENCE',
        'Motor Vehicles Department',
        'Licence No: DL-1420110012345',
        'Class of Vehicle: LMV, MCWG',
        'Valid Till: 2030',
    ].join('\n');

    test('classifies a driving licence (4 keyword hits + 3 boosts = 79)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('DRIVING_LICENSE');
        expect(r.label).toBe('Driving License');
        expect(r.confidence).toBe(79);
    });

    test('driving permit application form stays GENERAL', () => {
        const r = classifyDocument('International Driving Permit application form');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — PASSPORT', () => {
    const obvious = [
        'REPUBLIC OF INDIA',
        'PASSPORT',
        'Type: P',
        'Nationality: INDIAN',
        'Place of Issue: NEW DELHI',
    ].join('\n');

    test('classifies a passport (4/4 keyword hits = 70, no boosts needed)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('PASSPORT');
        expect(r.confidence).toBe(70);
    });

    test('visa/immigration boosts alone do NOT classify without passport keywords', () => {
        const r = classifyDocument('Visa application centre. Immigration clearance. MRZ code verified.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — BANK_STATEMENT', () => {
    const obvious = [
        'State Bank of India',
        'Account Statement',
        'Account Number: 12345678901',
        'IFSC: SBIN0001234',
        'Opening Balance: 50000',
        'Closing Balance: 65000',
        'Branch: Mumbai',
    ].join('\n');

    test('classifies a bank statement (5 keyword hits + 2 boosts = 65)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('BANK_STATEMENT');
        expect(r.confidence).toBe(65);
    });

    test('credit card bill reminder stays GENERAL (no bank keywords)', () => {
        const r = classifyDocument('Your credit card bill is due. Please pay the total amount.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — INVOICE', () => {
    const obvious = [
        'TAX INVOICE',
        'GSTIN: 27ABCDE1234F1Z5',
        'Bill To: Acme Corp',
        'Item Qty Unit Price',
        'Subtotal: 50000',
        'IGST: 9000',
        'Total: 59000',
    ].join('\n');

    test('classifies a tax invoice (5 keyword hits + 5 boosts = 69)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('INVOICE');
        expect(r.emoji).toBe('🧾');
        expect(r.label).toBe('Invoice');
        expect(r.confidence).toBe(69);
    });

    test('a lone "invoice" mention stays GENERAL (single hit capped at 20)', () => {
        const r = classifyDocument('Invoice attached for your reference.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBe(10);
    });

    test('borderline: exactly 30 confidence still classifies (>= threshold)', () => {
        // 'invoice' + 'gst' + 'gstin' = 3/7 hits -> (3/7)*70 = 30
        const r = classifyDocument('Invoice with GSTIN 27ABCDE');
        expect(r.category).toBe('INVOICE');
        expect(r.confidence).toBe(30);
    });
});

describe('classifyDocument — RECEIPT', () => {
    const obvious = [
        'PAYMENT RECEIPT',
        'Transaction ID: TXN123456',
        'Payment Received: Rs. 2500',
        'Amount Paid: Rs. 2500',
        'Payment Method: UPI',
        'Thank you for shopping!',
    ].join('\n');

    test('classifies a payment receipt (4 keyword hits + 3 boosts = 86)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('RECEIPT');
        expect(r.confidence).toBe(86);
    });

    test('threshold: 2 hits = 28 confidence stays GENERAL', () => {
        // 'receipt' + 'paid' = 2/5 hits -> (2/5)*70 = 28; no boost keywords present
        const r = classifyDocument('Payment receipt for your order. Paid in full.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBe(28);
    });

    test('adding a boost keyword flips it over the threshold (28 -> 38)', () => {
        const r = classifyDocument('Payment receipt for your order. Paid in full. Thank you!');
        expect(r.category).toBe('RECEIPT');
        expect(r.confidence).toBe(38);
    });

    test('"received" does not substring-match "receipt"', () => {
        const r = classifyDocument('We have received your application. You will be notified.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — SALARY_SLIP', () => {
    const obvious = [
        'SALARY SLIP - March 2024',
        'Employee: Rahul Verma',
        'Basic Pay: 60000',
        'HRA: 24000',
        'Gross Salary: 110000',
        'Deductions: PF 7200, ESI 1500',
        'Net Salary: 98000',
    ].join('\n');

    test('classifies a salary slip (4 keyword hits + 4 boosts = 64)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('SALARY_SLIP');
        expect(r.confidence).toBe(64);
    });

    test('"CTC" boost alone does not classify', () => {
        const r = classifyDocument('Your CTC is 12 LPA with annual bonus.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — TAX_RETURN', () => {
    const obvious = [
        'INCOME TAX RETURN',
        'Assessment Year 2024-25',
        'Form 26AS',
        'TDS: 45000',
        'Total Income: 850000',
        'Tax Payable: 12000',
        'Refund: 33000',
    ].join('\n');

    test('classifies a tax return (4 keyword hits + 3 boosts = 69)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('TAX_RETURN');
        expect(r.confidence).toBe(69);
    });

    test('a lone "TDS" mention stays GENERAL', () => {
        const r = classifyDocument('TDS certificate issued for FY 2023-24.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBeLessThan(30);
    });
});

describe('classifyDocument — MARKSHEET', () => {
    const obvious = [
        'BOARD EXAMINATION RESULT',
        'MARKSHEET',
        'Roll No: 12345',
        'Mathematics 95',
        'Science 88',
        'Total Marks: 460',
        'CGPA: 9.2',
        'University: Delhi University',
    ].join('\n');

    test('classifies a marksheet (3 keyword hits + 4 boosts = 46)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('MARKSHEET');
        expect(r.confidence).toBe(46);
    });

    test('exam schedule notice stays GENERAL (and education score stays < 40)', () => {
        const r = classifyDocument('Exam schedule: semester exams begin Monday.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBeLessThan(30);
    });
});

describe('classifyDocument — CERTIFICATE', () => {
    const obvious = [
        'CERTIFICATE OF COMPLETION',
        'This is to certify that Ananya Singh has completed the Advanced Python Course',
        'Awarded to: Ananya Singh',
    ].join('\n');

    test('classifies a certificate (4 keyword hits + 1 boost = 54)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('CERTIFICATE');
        expect(r.confidence).toBe(54);
    });

    test('a lone "certification" mention stays GENERAL', () => {
        const r = classifyDocument('Please find the certification details attached.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBeLessThan(30);
    });
});

describe('classifyDocument — RESUME', () => {
    const obvious = [
        'RESUME',
        'Rahul Sharma',
        'Career Objective: Software Engineer',
        'Work Experience: 3 years at TechCorp',
        'Technical Skills: Python, React, SQL',
        'Education: B.Tech',
    ].join('\n');

    test('classifies a resume (4 keyword hits + 3 boosts = 53)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('RESUME');
        expect(r.label).toBe('Resume / CV');
        expect(r.confidence).toBe(53);
    });

    test('experience letter stays GENERAL (no resume keywords)', () => {
        const r = classifyDocument('Experience letter: worked as intern from 2022 to 2023.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — INSURANCE', () => {
    const obvious = [
        'LIFE INSURANCE CORPORATION OF INDIA',
        'Policy No: 123456789',
        'Policyholder: Sunita Devi',
        'Premium: Rs. 25000 per year',
        'Sum Assured: Rs. 500000',
        'Nominee: Ramesh Devi',
    ].join('\n');

    test('classifies an insurance policy (5 keyword hits + 2 boosts = 70)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('INSURANCE');
        expect(r.confidence).toBe(70);
    });

    test('generic insurance ad copy stays GENERAL', () => {
        const r = classifyDocument('Insurance is important. Buy insurance today.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBeLessThan(30);
    });
});

describe('classifyDocument — ELECTRICITY_BILL', () => {
    const obvious = [
        'ELECTRICITY BILL',
        'Consumer No: 123456',
        'Meter Reading: 45210',
        'Energy Charge: 1800',
        'Units Consumed: 320 kWh',
        'Billing Period: Jan 2024',
        'Due Date: 15/02/2024',
    ].join('\n');

    test('classifies an electricity bill (6/6 keyword hits + 3 boosts = 93)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('ELECTRICITY_BILL');
        expect(r.confidence).toBe(93);
    });

    test('"Electricity Bill" alone is NOT enough (2 hits = 23 < 30)', () => {
        const r = classifyDocument('Electricity Bill');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBe(23);
    });
});

describe('classifyDocument — PHONE_BILL', () => {
    const obvious = [
        'AIRTEL MOBILE BILL',
        'Data Usage: 45 GB',
        'Call Charges: Rs. 120',
        'Plan: Infinity 399',
        'Recharge now, Validity 28 days',
    ].join('\n');

    test('classifies a phone bill (3 keyword hits + 4 boosts = 56)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('PHONE_BILL');
        expect(r.confidence).toBe(56);
    });

    test('"JioCinema" substring hit alone stays GENERAL (single "jio" hit capped)', () => {
        const r = classifyDocument('JioCinema subscription renewed for one year.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBeLessThan(30);
    });
});

describe('classifyDocument — MEDICAL_REPORT', () => {
    const obvious = [
        'CITY HOSPITAL',
        'LAB REPORT',
        'Patient: Mohan Lal',
        'Diagnosis: Type 2 Diabetes',
        'Blood Test: HbA1c 8.2%',
        'Medicine: Metformin',
        'Doctor: Dr. Gupta, MBBS',
    ].join('\n');

    test('classifies a medical report (2 keyword hits + 6 boosts = 43)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('MEDICAL_REPORT');
        expect(r.confidence).toBe(43);
    });

    test('doctor appointment reminder stays GENERAL (boosts need keyword hits)', () => {
        const r = classifyDocument('Doctor appointment reminder: visit Dr. Sharma on Friday.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

describe('classifyDocument — PROPERTY_DOC', () => {
    const obvious = [
        'SALE DEED',
        'Property at Plot 42, Sector 5',
        'Deed of Conveyance',
        'Registered at Sub-Registrar Office',
        'Registration No: 12345',
    ].join('\n');

    test('classifies a property document (4 keyword hits + 2 boosts = 50)', () => {
        const r = classifyDocument(obvious);
        expect(r.category).toBe('PROPERTY_DOC');
        expect(r.confidence).toBe(50);
    });

    test('"property tax receipt": single-hit rules stay below threshold -> GENERAL', () => {
        // RECEIPT wins the low-confidence tie (earlier in RULES): 1/5 hits -> 14
        const r = classifyDocument('Property tax receipt for FY 2024.');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBe(14);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// classifyDocument — priority / conflict resolution
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyDocument — priority and conflict resolution', () => {
    test('exact tie (35 vs 35) is won by the rule listed first in RULES (AADHAAR before CERTIFICATE)', () => {
        const r = classifyDocument('aadhaar uidai enrolment no certificate certify certification');
        expect(r.category).toBe('AADHAAR_CARD');
        expect(r.confidence).toBe(35);
    });

    test('higher confidence wins: resume mentioning certificates -> RESUME', () => {
        const r = classifyDocument(
            'Resume of John. Work experience 5 years. Technical skills: Python. Also holds certificates.',
        );
        // RESUME: 3 hits (30) + 'skills' & 'experience' boosts (8.57) = 39;
        // CERTIFICATE: 'certificate' single hit -> 12
        expect(r.category).toBe('RESUME');
        expect(r.confidence).toBe(39);
    });

    test('receipt for an invoice classifies as RECEIPT (3 hits beat 1 hit)', () => {
        const r = classifyDocument('Invoice INV-100. Payment received. Paid in full. Receipt attached.');
        expect(r.category).toBe('RECEIPT');
        expect(r.confidence).toBe(42);
    });

    test('strong content ignores a misleading filename ("resume.pdf" + invoice content)', () => {
        const r = classifyDocument(
            'TAX INVOICE\nGSTIN: 27ABCDE1234F1Z5\nBill To: Acme\nSubtotal: 100\nTotal: 118',
            'resume.pdf',
        );
        expect(r.category).toBe('INVOICE');
    });

    test('passport with visa mentions: PASSPORT beats PHONE_BILL "vi" substring hit', () => {
        const r = classifyDocument('PASSPORT. Nationality: INDIAN. Visa issued. Immigration cleared.');
        // PASSPORT: 2 hits (35) + 2 boosts (20) = 55; PHONE_BILL: 'vi' in "visa" = 1 hit -> 9
        expect(r.category).toBe('PASSPORT');
        expect(r.confidence).toBe(55);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// classifyDocument — filename pattern fallback (content confidence < 30)
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyDocument — filename pattern fallback', () => {
    test('"electricity_bill_march.pdf" -> ELECTRICITY_BILL, confidence 45', () => {
        const r = classifyDocument(WEAK, 'electricity_bill_march.pdf');
        expect(r.category).toBe('ELECTRICITY_BILL');
        expect(r.confidence).toBe(45);
    });

    test('"resume.pdf" -> RESUME, confidence 45', () => {
        const r = classifyDocument(WEAK, 'resume.pdf');
        expect(r.category).toBe('RESUME');
        expect(r.confidence).toBe(45);
    });

    test('"resume_2024.pdf" does NOT match: "_" is a word char so \\bresume\\b fails -> GENERAL', () => {
        const r = classifyDocument(WEAK, 'resume_2024.pdf');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });

    test('"salary-slip-march.pdf" -> SALARY_SLIP, confidence 45', () => {
        const r = classifyDocument(WEAK, 'salary-slip-march.pdf');
        expect(r.category).toBe('SALARY_SLIP');
        expect(r.confidence).toBe(45);
    });

    test('"ITR-2024.pdf" -> TAX_RETURN via \\bitr\\b, confidence 45', () => {
        const r = classifyDocument(WEAK, 'ITR-2024.pdf');
        expect(r.category).toBe('TAX_RETURN');
        expect(r.confidence).toBe(45);
    });

    test('"my-passport-scan.pdf" -> PASSPORT, confidence 45', () => {
        const r = classifyDocument(WEAK, 'my-passport-scan.pdf');
        expect(r.category).toBe('PASSPORT');
        expect(r.confidence).toBe(45);
    });

    test('"marksheet.pdf" -> MARKSHEET with the filename-path emoji/label (not the rule ones)', () => {
        const r = classifyDocument(WEAK, 'marksheet.pdf');
        expect(r.category).toBe('MARKSHEET');
        expect(r.emoji).toBe('📝'); // filename pattern label, vs '🎓' from content rules
        expect(r.label).toBe('Marksheet');
        expect(r.confidence).toBe(45);
    });

    test('first matching pattern wins: "aadhaar_pan.pdf" -> AADHAAR_CARD (aadhaar pattern listed first)', () => {
        const r = classifyDocument(WEAK, 'aadhaar_pan.pdf');
        expect(r.category).toBe('AADHAAR_CARD');
        expect(r.confidence).toBe(45);
    });

    test('"phone_bill.pdf" has NO filename pattern -> GENERAL_DOCUMENT (documents the gap)', () => {
        const r = classifyDocument(WEAK, 'phone_bill.pdf');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });

    test('generic camera dump "IMG_20240215.jpg" matches nothing -> GENERAL_DOCUMENT', () => {
        const r = classifyDocument(WEAK, 'IMG_20240215.jpg');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });

    test('Hinglish filename "bijli_bill.pdf" matches the \\bbijli pattern -> ELECTRICITY_BILL', () => {
        const r = classifyDocument(WEAK, 'bijli_bill.pdf');
        expect(r.category).toBe('ELECTRICITY_BILL');
        expect(r.confidence).toBe(45);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// classifyDocument — education second-pass scoring
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyDocument — EDUCATION second pass', () => {
    test('CBSE physics notes: subject filename (+25) + structure (+30) + board (+20) = 75', () => {
        const r = classifyDocument(
            'Chapter 1: Laws of Motion. Class 10 Physics. CBSE syllabus. Practice questions and answer key included.',
            'physics-chapter1.pdf',
        );
        expect(r.category).toBe('EDUCATION');
        expect(r.emoji).toBe('🎓');
        expect(r.label).toBe('Education');
        expect(r.confidence).toBe(75);
    });

    test('ICSE detection: structure (+30) + icse board (+20) = 50', () => {
        const r = classifyDocument(
            'ICSE Class 10 History. Chapter 3 notes with question paper and answer key for practice.',
            'sample-paper.pdf',
        );
        expect(r.category).toBe('EDUCATION');
        expect(r.confidence).toBe(50);
    });

    test('technical terms alone score 20 (< 40) -> GENERAL_DOCUMENT', () => {
        const r = classifyDocument(
            'The theorem proves the equation; the formula and diagram illustrate the proof with an example derivation.',
            'doc.pdf',
        );
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });

    test('technical terms + structure keywords (20 + 30 = 50) -> EDUCATION', () => {
        const r = classifyDocument(
            'The theorem proves the equation; the formula and diagram illustrate the proof. Chapter 2 exercise questions.',
            'doc.pdf',
        );
        expect(r.category).toBe('EDUCATION');
        expect(r.confidence).toBe(50);
    });

    test('score caps at 85 even when raw signals sum to 110', () => {
        const r = classifyDocument(
            'Chapter 1. Exercise 2. Question bank for CBSE Class 12. Theorem: every equation has a formula. See diagram, proof and example.',
            'maths-notes.pdf',
        );
        expect(r.category).toBe('EDUCATION');
        expect(r.confidence).toBe(85);
    });

    test('education never overrides a real classification: invoice + "physics.pdf" -> INVOICE', () => {
        const r = classifyDocument(
            'TAX INVOICE\nGSTIN: 27ABCDE1234F1Z5\nBill To: Acme\nSubtotal: 100\nTotal: 118',
            'physics.pdf',
        );
        expect(r.category).toBe('INVOICE');
    });

    test('state boards are NOT special-cased: board-like content without CBSE/ICSE signals stays GENERAL', () => {
        const r = classifyDocument(
            'Maharashtra State Board syllabus chapter 1 exercise',
            'doc.pdf',
        );
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// classifyDocument — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyDocument — edge cases', () => {
    test('empty content, no filename -> GENERAL_DOCUMENT with confidence 0', () => {
        const r = classifyDocument('');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.emoji).toBe('📄');
        expect(r.label).toBe('Document');
        expect(r.confidence).toBe(0);
    });

    test('empty content + "aadhaar.pdf" -> filename fallback still works', () => {
        const r = classifyDocument('', 'aadhaar.pdf');
        expect(r.category).toBe('AADHAAR_CARD');
        expect(r.confidence).toBe(45);
    });

    test('empty-string filename is falsy -> no filename fallback', () => {
        const r = classifyDocument('hello', '');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });

    test('garbage text stays GENERAL', () => {
        const r = classifyDocument('xqz! @#$ 12345 abcd asdf qwer');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });

    test('ALL CAPS content still matches (case-insensitive)', () => {
        const r = classifyDocument('TAX INVOICE GSTIN BILL TO SUBTOTAL TOTAL');
        expect(r.category).toBe('INVOICE');
        expect(r.confidence).toBeGreaterThanOrEqual(30);
    });

    test('very long content classifies without error', () => {
        const chunk = 'TAX INVOICE GSTIN: 27ABCDE1234F1Z5 Bill To: Acme Subtotal: 100 Total: 118 ';
        const r = classifyDocument(chunk.repeat(500));
        expect(r.category).toBe('INVOICE');
    });

    test('Hindi-only content matches no English keywords -> GENERAL', () => {
        const r = classifyDocument('यह एक बिजली का बिल है');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });

    test('mixed Hindi + English keywords classify on the English signals', () => {
        const r = classifyDocument('TAX INVOICE चालान\nGSTIN 123\nBill To: राम');
        expect(r.category).toBe('INVOICE');
    });

    test('"vi" substring false positive: "Review of the provision of services" stays GENERAL', () => {
        const r = classifyDocument('Review of the provision of services');
        expect(r.category).toBe('GENERAL_DOCUMENT');
        expect(r.confidence).toBeLessThan(30);
    });

    test('bare 12-digit number alone does not classify as Aadhaar', () => {
        const r = classifyDocument('123456789012');
        expect(r.category).toBe('GENERAL_DOCUMENT');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ClassificationResult shape
// ═══════════════════════════════════════════════════════════════════════════

describe('ClassificationResult shape', () => {
    test('INVOICE result has the exact category/emoji/label fields', () => {
        const r = classifyDocument('TAX INVOICE GSTIN Bill To: Acme Total: 100');
        expect(r).toMatchObject({
            category: 'INVOICE',
            emoji: '🧾',
            label: 'Invoice',
        });
    });

    test('GENERAL result has the exact fallback fields', () => {
        const r = classifyDocument('nothing to see here');
        expect(r).toMatchObject({
            category: 'GENERAL_DOCUMENT',
            emoji: '📄',
            label: 'Document',
        });
    });

    test('confidence is always an integer between 0 and 100', () => {
        const samples = [
            classifyDocument('TAX INVOICE GSTIN: 27ABCDE1234F1Z5 Bill To: Acme Subtotal: 100 IGST: 9 Total: 109'),
            classifyDocument('Salary slip gross salary net salary basic pay hra pf'),
            classifyDocument('hello world'),
            classifyDocument(''),
            classifyDocument(WEAK, 'resume.pdf'),
        ];
        for (const r of samples) {
            expect(Number.isInteger(r.confidence)).toBe(true);
            expect(r.confidence).toBeGreaterThanOrEqual(0);
            expect(r.confidence).toBeLessThanOrEqual(100);
        }
    });

    test('result object has exactly the four documented keys', () => {
        const r = classifyDocument('TAX INVOICE GSTIN Bill To: Acme');
        expect(Object.keys(r).sort()).toEqual(['category', 'confidence', 'emoji', 'label']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// extractSmartTitle
// ═══════════════════════════════════════════════════════════════════════════

describe('extractSmartTitle — generic filenames get identifier-based titles', () => {
    test('"scan_20240215.pdf" + bank content -> "Bank Statement — HDFC"', () => {
        const content = [
            'SBI savings account statement.',
            'IFSC SBIN001.',
            'Opening balance 5000.',
            'Closing balance 6000.',
            'Branch Mumbai.',
        ].join('\n');
        const classification = classifyDocument(content);
        expect(classification.category).toBe('BANK_STATEMENT');
        expect(classification.confidence).toBeGreaterThan(40);
        expect(extractSmartTitle(content, 'scan_20240215.pdf', classification)).toBe(
            'Bank Statement — SBI',
        );
    });

    test('"download(3).pdf" + Aadhaar content -> "Aadhaar Card — ****-****-9012"', () => {
        // NOTE: \s in the identifier regex matches newlines, so the year in a
        // "DOB 01/01/1990" line would glue to the next line ("1990\n1234 5678").
        // Use a 2-digit year here to keep the 12-digit pattern unambiguous.
        const content = [
            'Government of India',
            'Aadhaar card',
            'Enrolment no 1234/56789/01234',
            'UIDAI',
            'DOB 01/01/90',
            '1234 5678 9012',
        ].join('\n');
        const classification = classifyDocument(content);
        expect(classification.category).toBe('AADHAAR_CARD');
        expect(classification.confidence).toBeGreaterThan(40);
        expect(extractSmartTitle(content, 'download(3).pdf', classification)).toBe(
            'Aadhaar Card — ****-****-9012',
        );
    });

    test('generic "IMG_001.jpg" + invoice content -> "Invoice — #INV-2024-001"', () => {
        const content = 'Tax Invoice INV-2024-001 dated 12/01/2024. GSTIN 27ABCDE1234F1Z5. Total 59000.';
        const classification = classifyDocument(content);
        expect(classification.category).toBe('INVOICE');
        expect(classification.confidence).toBeGreaterThan(40);
        expect(extractSmartTitle(content, 'IMG_001.jpg', classification)).toBe(
            'Invoice — #INV-2024-001',
        );
    });

    test('generic name + salary slip content -> "Salary Slip — March 2024"', () => {
        const content = 'Salary Slip March 2024. Basic pay 60000. Gross salary 110000. Net salary 98000. HRA 24000.';
        const classification = classifyDocument(content);
        expect(classification.category).toBe('SALARY_SLIP');
        expect(classification.confidence).toBeGreaterThan(40);
        expect(extractSmartTitle(content, 'scan2.pdf', classification)).toBe(
            'Salary Slip — March 2024',
        );
    });

    test('bank content with NO recognizable bank name falls back to first line', () => {
        const content = 'Account statement.\nIFSC code here.';
        const classification = fakeClassification('BANK_STATEMENT', 'Bank Statement', 65);
        expect(extractSmartTitle(content, 'scan.pdf', classification)).toBe('Account statement.');
    });

    test('dashed Aadhaar number (1234-5678-9012) falls back to the first line, masked', () => {
        const content = 'Aadhaar 1234-5678-9012 details';
        const classification = fakeClassification('AADHAAR_CARD', 'Aadhaar Card', 60);
        expect(extractSmartTitle(content, 'scan.pdf', classification)).toBe(
            'Aadhaar ****-****-9012 details',
        );
    });

    test('first-line title masks a PAN number and a phone number', () => {
        const classification = fakeClassification('GENERAL_DOCUMENT', 'Document', 0);
        expect(extractSmartTitle('PAN ABCDE1234F', 'scan.pdf', classification)).toBe('PAN ABCDE****F');
        expect(extractSmartTitle('Call 9876543210 now', 'scan.pdf', classification)).toBe('Call ******3210 now');
    });

    test('confidence exactly 40 does NOT use the identifier path (needs > 40)', () => {
        const classification = fakeClassification('INVOICE', 'Invoice', 40);
        expect(extractSmartTitle('Invoice INV-9', 'download.pdf', classification)).toBe(
            'Invoice INV-9',
        );
    });

    test('confidence 41 uses the identifier path', () => {
        const classification = fakeClassification('INVOICE', 'Invoice', 41);
        expect(extractSmartTitle('Invoice INV-9', 'download.pdf', classification)).toBe(
            'Invoice — #INV-9',
        );
    });

    test('GENERAL_DOCUMENT with high confidence still uses the first-line path', () => {
        const classification = fakeClassification('GENERAL_DOCUMENT', 'Document', 90);
        expect(
            extractSmartTitle('Hello world document\nline two', 'scan.pdf', classification),
        ).toBe('Hello world document');
    });

    test('low-confidence classification -> first line of content', () => {
        const classification = fakeClassification('GENERAL_DOCUMENT', 'Document', 12);
        expect(
            extractSmartTitle('Some random document\nsecond line', 'download.pdf', classification),
        ).toBe('Some random document');
    });

    test('"whatsapp_doc.pdf" counts as a generic name', () => {
        const classification = fakeClassification('GENERAL_DOCUMENT', 'Document', 10);
        expect(
            extractSmartTitle(
                'Meeting notes from yesterday\nDiscussed the quarterly plan',
                'whatsapp_doc.pdf',
                classification,
            ),
        ).toBe('Meeting notes from yesterday');
    });

    test('uppercase "SCAN_001.PDF" is generic (.pdf stripped case-insensitively)', () => {
        const classification = fakeClassification('INVOICE', 'Invoice', 50);
        expect(
            extractSmartTitle('Just some scanned notes here\nSecond line', 'SCAN_001.PDF', classification),
        ).toBe('Just some scanned notes here');
    });
});

describe('extractSmartTitle — first-line selection rules', () => {
    const low = fakeClassification('GENERAL_DOCUMENT', 'Document', 10);

    test('skips lines shorter than 9 chars, picks the next valid one', () => {
        expect(
            extractSmartTitle('Hi\nThis is a proper document title', 'img_5.jpg', low),
        ).toBe('This is a proper document title');
    });

    test('skips lines 60+ chars', () => {
        expect(extractSmartTitle('x'.repeat(100), 'scan_x.pdf', low)).toBe('scan_x');
    });

    test('content of 5 chars or fewer skips first-line extraction entirely', () => {
        expect(extractSmartTitle('abc', 'scan.pdf', low)).toBe('scan');
    });

    test('trims whitespace-only lines before measuring', () => {
        expect(
            extractSmartTitle('   \nA clean title line here', 'download.pdf', low),
        ).toBe('A clean title line here');
    });
});

describe('extractSmartTitle — non-generic filenames', () => {
    const high = fakeClassification('RESUME', 'Resume / CV', 90);

    test('"My_Resume_2024.pdf" is returned cleaned but not prettified', () => {
        expect(extractSmartTitle('whatever content', 'My_Resume_2024.pdf', high)).toBe(
            'My_Resume_2024',
        );
    });

    test('non-generic name wins even with a high-confidence classification', () => {
        expect(extractSmartTitle('Invoice INV-1', 'march-bills.pdf', high)).toBe('march-bills');
    });

    test('filename without .pdf extension passes through', () => {
        expect(extractSmartTitle('x', 'statement', high)).toBe('statement');
    });

    test('surrounding whitespace: .pdf is stripped BEFORE trim, so "  padded.pdf  " keeps ".pdf"', () => {
        // cleanFileName = fileName.replace(/\.pdf$/i, '').trim() — the regex runs first
        expect(extractSmartTitle('x', '  padded.pdf  ', high)).toBe('padded.pdf');
    });

    test('empty filename -> "Untitled Document"', () => {
        expect(extractSmartTitle('some content here', '', high)).toBe('Untitled Document');
    });
});
