/**
 * DocumentClassifier.ts — Zero-cost keyword-based document type classification.
 *
 * Classifies PDFs into categories based on OCR/extracted text content.
 * Pure JavaScript — no ML, no memory, no heat. Runs in <1ms.
 *
 * Also extracts a "smart title" from the content when the filename is
 * unhelpful (e.g., "scan_20240215.pdf" → "SBI Account Statement").
 */

import { maskSensitiveData } from './DataMasking';

// ─── Document Categories ────────────────────────────────────────────────────

/** The 18 document categories the classifier can assign. */
export type DocumentCategory =
    | 'AADHAAR_CARD'
    | 'PAN_CARD'
    | 'VOTER_ID'
    | 'DRIVING_LICENSE'
    | 'PASSPORT'
    | 'BANK_STATEMENT'
    | 'INVOICE'
    | 'RECEIPT'
    | 'SALARY_SLIP'
    | 'TAX_RETURN'
    | 'MARKSHEET'
    | 'CERTIFICATE'
    | 'RESUME'
    | 'INSURANCE'
    | 'ELECTRICITY_BILL'
    | 'PHONE_BILL'
    | 'MEDICAL_REPORT'
    | 'PROPERTY_DOC'
    | 'EDUCATION'
    | 'GENERAL_DOCUMENT';

// ─── Classification Rules ───────────────────────────────────────────────────
// Each rule: [category, emoji, display label, required keywords (ANY match), boost keywords (extra confidence)]

interface ClassificationRule {
    category: DocumentCategory;
    emoji: string;
    label: string;
    /** At least ONE of these must match (case-insensitive) */
    keywords: string[];
    /** If ANY of these also match, confidence increases (used for tiebreaking) */
    boostKeywords?: string[];
}

const RULES: ClassificationRule[] = [
    {
        category: 'AADHAAR_CARD',
        emoji: '🪪',
        label: 'Aadhaar Card',
        keywords: ['aadhaar', 'aadhar', 'uidai', 'unique identification authority', 'enrolment no', 'aadhaar no'],
        boostKeywords: ['government of india', 'dob', '12 digit', 'vid number', 'eid number'],
    },
    {
        category: 'PAN_CARD',
        emoji: '💳',
        label: 'PAN Card',
        keywords: ['permanent account number', 'income tax', 'pan card', 'pan no'],
        boostKeywords: ['father', 'govt of india', 'signature'],
    },
    {
        category: 'VOTER_ID',
        emoji: '🗳️',
        label: 'Voter ID',
        keywords: ['election commission', 'electoral', 'epic no', 'electors photo', 'voter id'],
        boostKeywords: ['constituency', 'polling station', 'voter'],
    },
    {
        category: 'DRIVING_LICENSE',
        emoji: '🚗',
        label: 'Driving License',
        keywords: ['driving licence', 'driving license', 'licence no', 'motor vehicle', 'class of vehicle'],
        boostKeywords: ['valid till', 'transport', 'lmv', 'mcwg'],
    },
    {
        category: 'PASSPORT',
        emoji: '🛂',
        label: 'Passport',
        keywords: ['passport', 'republic of india', 'nationality', 'place of issue'],
        boostKeywords: ['visa', 'immigration', 'mrz'],
    },
    {
        category: 'BANK_STATEMENT',
        emoji: '🏦',
        label: 'Bank Statement',
        keywords: ['account statement', 'bank statement', 'account number', 'ifsc', 'opening balance', 'closing balance'],
        boostKeywords: ['debit', 'credit', 'transaction', 'branch', 'sbi', 'hdfc', 'icici', 'axis', 'kotak'],
    },
    {
        category: 'INVOICE',
        emoji: '🧾',
        label: 'Invoice',
        keywords: ['invoice', 'bill to', 'ship to', 'gst', 'gstin', 'tax invoice', 'proforma'],
        boostKeywords: ['subtotal', 'total', 'qty', 'quantity', 'unit price', 'igst', 'cgst', 'sgst'],
    },
    {
        category: 'RECEIPT',
        emoji: '🧾',
        label: 'Receipt',
        keywords: ['receipt', 'payment received', 'paid', 'transaction id', 'order confirmation'],
        boostKeywords: ['thank you', 'amount paid', 'payment method'],
    },
    {
        category: 'SALARY_SLIP',
        emoji: '💰',
        label: 'Salary Slip',
        keywords: ['salary slip', 'pay slip', 'payslip', 'gross salary', 'net salary', 'basic pay'],
        boostKeywords: ['hra', 'da', 'pf', 'esi', 'deductions', 'earnings', 'ctc'],
    },
    {
        category: 'TAX_RETURN',
        emoji: '📊',
        label: 'Tax Return',
        keywords: ['income tax return', 'itr', 'form 16', 'form 26as', 'tds', 'assessment year'],
        boostKeywords: ['pan', 'total income', 'tax payable', 'refund'],
    },
    {
        category: 'MARKSHEET',
        emoji: '🎓',
        label: 'Marksheet',
        keywords: ['marksheet', 'mark sheet', 'examination', 'semester', 'grade card', 'cgpa', 'sgpa', 'marks obtained'],
        boostKeywords: ['roll no', 'subject', 'total marks', 'university', 'board', 'exam result'],
    },
    {
        category: 'CERTIFICATE',
        emoji: '📜',
        label: 'Certificate',
        keywords: ['certificate', 'certify', 'certification', 'hereby certify', 'awarded to', 'completion'],
        boostKeywords: ['course', 'training', 'achievement', 'merit'],
    },
    {
        category: 'RESUME',
        emoji: '📋',
        label: 'Resume / CV',
        keywords: ['resume', 'curriculum vitae', 'work experience', 'career objective', 'professional summary', 'technical skills', 'certifications'],
        boostKeywords: ['education', 'skills', 'projects', 'languages', 'references', 'experience', 'intern'],
    },
    {
        category: 'INSURANCE',
        emoji: '🛡️',
        label: 'Insurance Policy',
        keywords: ['insurance', 'policy no', 'policyholder', 'insured', 'premium', 'sum assured'],
        boostKeywords: ['nominee', 'claim', 'coverage', 'lic', 'health insurance'],
    },
    {
        category: 'ELECTRICITY_BILL',
        emoji: '⚡',
        label: 'Electricity Bill',
        keywords: ['electricity bill', 'electricity', 'energy charge', 'kwh', 'meter reading', 'consumer no'],
        boostKeywords: ['units consumed', 'billing period', 'due date', 'fixed charge'],
    },
    {
        category: 'PHONE_BILL',
        emoji: '📱',
        label: 'Phone / Internet Bill',
        keywords: ['mobile bill', 'phone bill', 'broadband', 'data usage', 'airtel', 'jio', 'bsnl', 'vi'],
        boostKeywords: ['plan', 'recharge', 'validity', 'call charges'],
    },
    {
        category: 'MEDICAL_REPORT',
        emoji: '🏥',
        label: 'Medical Report',
        keywords: ['medical report', 'medical certificate', 'diagnosis', 'prescription', 'lab report', 'medical practitioner'],
        boostKeywords: ['patient', 'doctor', 'hospital', 'blood test', 'medicine', 'mbbs', 'opd', 'nmc', 'treatment'],
    },
    {
        category: 'PROPERTY_DOC',
        emoji: '🏠',
        label: 'Property Document',
        keywords: ['property', 'deed', 'registry', 'conveyance', 'sale deed', 'lease agreement', 'rent agreement'],
        boostKeywords: ['plot', 'flat', 'landlord', 'tenant', 'square feet', 'registration'],
    },
];

// ─── Classifier ─────────────────────────────────────────────────────────────

/** Result of classifying a document: its category plus a display emoji. */
export interface ClassificationResult {
    category: DocumentCategory;
    emoji: string;
    label: string;
    confidence: number;   // 0-100
}

/**
 * Classify a document based on its extracted text content.
 * Falls back to filename-based classification for password-protected PDFs.
 *
 * Requires ≥25% confidence to classify — prevents casual keyword mentions
 * (e.g., "submit your Aadhaar") from being wrongly categorized.
 */
const MIN_CLASSIFICATION_CONFIDENCE = 30;

// ─── Filename Pattern Fallback ──────────────────────────────────────────────
// Used when content extraction fails (password-protected, encrypted PDFs)
const FILENAME_PATTERNS: { pattern: RegExp; category: DocumentCategory; emoji: string; label: string }[] = [
    { pattern: /\be?-?aadh?a?a?r/i, category: 'AADHAAR_CARD', emoji: '🪪', label: 'Aadhaar Card' },
    { pattern: /\bpan[-_ ]?card|\bpan[-_ ]?no/i, category: 'PAN_CARD', emoji: '💳', label: 'PAN Card' },
    { pattern: /\bvoter[-_ ]?id|\bepic\b/i, category: 'VOTER_ID', emoji: '🗳️', label: 'Voter ID' },
    { pattern: /\bdriv(ing|er)?[-_ ]?li[cs]en[cs]e|\bdl\b/i, category: 'DRIVING_LICENSE', emoji: '🚗', label: 'Driving License' },
    { pattern: /\bpassport\b/i, category: 'PASSPORT', emoji: '🛂', label: 'Passport' },
    { pattern: /\bbank[-_ ]?stat|\baccount[-_ ]?(stat|detail|summar)|\b(kotak|sbi|hdfc|icici|axis|811)[-_ ]?(account|stat)/i, category: 'BANK_STATEMENT', emoji: '🏦', label: 'Bank Statement' },
    { pattern: /\binvoice\b/i, category: 'INVOICE', emoji: '🧾', label: 'Invoice' },
    { pattern: /\breceipt\b/i, category: 'RECEIPT', emoji: '🧾', label: 'Receipt' },
    { pattern: /\bsalary[-_ ]?slip|\bpay[-_ ]?slip/i, category: 'SALARY_SLIP', emoji: '💰', label: 'Salary Slip' },
    { pattern: /\bitr\b|\btax[-_ ]?return|\bform[-_ ]?16/i, category: 'TAX_RETURN', emoji: '📊', label: 'Tax Return' },
    { pattern: /\bmark[-_ ]?sheet/i, category: 'MARKSHEET', emoji: '📝', label: 'Marksheet' },
    { pattern: /\bcertificat/i, category: 'CERTIFICATE', emoji: '📜', label: 'Certificate' },
    { pattern: /\bresume\b|\bcv\b/i, category: 'RESUME', emoji: '📋', label: 'Resume / CV' },
    { pattern: /\binsurance\b/i, category: 'INSURANCE', emoji: '🛡️', label: 'Insurance' },
    { pattern: /\belectric|\bbijli|\bpower[-_ ]?bill/i, category: 'ELECTRICITY_BILL', emoji: '⚡', label: 'Electricity Bill' },
    { pattern: /\bmedical\b|\bprescri|\blab[-_ ]?report/i, category: 'MEDICAL_REPORT', emoji: '🏥', label: 'Medical Report' },
    { pattern: /\bproperty\b|\bdeed\b|\brent[-_ ]?agree|\blease\b/i, category: 'PROPERTY_DOC', emoji: '🏠', label: 'Property Document' },
];

// ─── Education Second-Pass Scorer ───────────────────────────────────────────
// Multi-signal scoring for educational docs — only used on unclassified docs

const SUBJECT_FILENAME_PATTERNS = /\b(physics|phy|chemistry|chem|biology|bio|maths?|math|science|english|hindi|history|geography|geo|economics|eco|computer|comp|civics|sociology|psychology|philosophy|accounting|commerce|sanskrit)\b/i;

const CONTENT_STRUCTURE_KEYWORDS = [
    'chapter', 'exercise', 'question paper', 'question bank', 'answer key',
    'notes', 'assignment', 'syllabus', 'tutorial', 'lecture', 'lesson',
    'textbook', 'study material', 'practice', 'worksheet', 'handout',
];

const EXAM_BOARD_KEYWORDS = [
    'ncert', 'cbse', 'icse', 'isc', 'jee', 'neet', 'upsc',
    'class 10', 'class 12', 'class 11', 'class 9', 'class 8',
    'board exam', 'entrance exam', 'competitive exam',
    'semester', 'unit test', 'mid term', 'final exam',
];

const TECHNICAL_TERMS = [
    'theorem', 'equation', 'formula', 'diagram', 'experiment',
    'hypothesis', 'derivation', 'proof', 'solution', 'example',
    'figure', 'table', 'graph', 'illustration', 'appendix',
    'objective', 'subjective', 'mcq', 'multiple choice',
];

const scoreEducation = (lowerContent: string, fileName: string): number => {
    let score = 0;

    // Signal 1: Subject name in filename (+25)
    if (SUBJECT_FILENAME_PATTERNS.test(fileName.toLowerCase())) {
        score += 25;
    }

    // Signal 2: Content structure markers (+15 each, max 30)
    let structureHits = 0;
    for (const kw of CONTENT_STRUCTURE_KEYWORDS) {
        if (lowerContent.includes(kw)) {
            structureHits++;
            if (structureHits >= 2) break;
        }
    }
    score += structureHits * 15;

    // Signal 3: Exam board / class references (+20)
    for (const kw of EXAM_BOARD_KEYWORDS) {
        if (lowerContent.includes(kw)) {
            score += 20;
            break;
        }
    }

    // Signal 4: Technical term density (+20 if 3+ terms found)
    let techHits = 0;
    for (const kw of TECHNICAL_TERMS) {
        if (lowerContent.includes(kw)) {
            techHits++;
            if (techHits >= 3) break;
        }
    }
    if (techHits >= 3) score += 20;

    // Signal 5: Folder path has educational terms (+15)
    const lowerPath = fileName.toLowerCase();
    if (/\b(notes|study|college|school|class|semester|exam|education)\b/i.test(lowerPath)) {
        score += 15;
    }

    return score;
};

/**
 * Classify a document into one of 18 categories using keyword scoring.
 * @param content Document text content to score.
 * @param fileName Optional file name/path — used as an extra scoring signal.
 * @returns The winning category with its display emoji.
 */
export const classifyDocument = (content: string, fileName?: string): ClassificationResult => {
    const lowerContent = content.toLowerCase();

    let bestMatch: ClassificationResult = {
        category: 'GENERAL_DOCUMENT',
        emoji: '📄',
        label: 'Document',
        confidence: 0,
    };

    for (const rule of RULES) {
        // Count keyword matches
        const keywordHits = rule.keywords.filter(kw => lowerContent.includes(kw)).length;
        if (keywordHits === 0) continue;

        // Base confidence from keyword coverage
        let confidence = Math.min((keywordHits / rule.keywords.length) * 70, 70);

        // Require at least 2 keyword hits for a confident classification
        // A single generic keyword match is not enough
        if (keywordHits < 2) {
            confidence = Math.min(confidence, 20); // Cap single-hit to below threshold
        }

        // Boost from boost keywords
        if (rule.boostKeywords) {
            const boostHits = rule.boostKeywords.filter(kw => lowerContent.includes(kw)).length;
            confidence += Math.min((boostHits / rule.boostKeywords.length) * 30, 30);
        }

        if (confidence > bestMatch.confidence) {
            bestMatch = {
                category: rule.category,
                emoji: rule.emoji,
                label: rule.label,
                confidence: Math.round(confidence),
            };
        }
    }

    // If confidence is too low, try filename-based classification
    if (bestMatch.confidence < MIN_CLASSIFICATION_CONFIDENCE && fileName) {
        const lowerFileName = fileName.toLowerCase();
        for (const fp of FILENAME_PATTERNS) {
            if (fp.pattern.test(lowerFileName)) {
                return {
                    category: fp.category,
                    emoji: fp.emoji,
                    label: fp.label,
                    confidence: 45, // Filename match = decent confidence, but lower than content-based
                };
            }
        }
    }

    // ── Second Pass: Education Detection (only for unclassified docs) ────
    // Safe: only runs on docs that didn't match any other category
    if (bestMatch.confidence < MIN_CLASSIFICATION_CONFIDENCE) {
        const eduScore = scoreEducation(lowerContent, fileName || '');
        if (eduScore >= 40) {
            return {
                category: 'EDUCATION',
                emoji: '🎓',
                label: 'Education',
                confidence: Math.min(eduScore, 85),
            };
        }
    }

    // If still too low, default to General
    if (bestMatch.confidence < MIN_CLASSIFICATION_CONFIDENCE) {
        return {
            category: 'GENERAL_DOCUMENT',
            emoji: '📄',
            label: 'Document',
            confidence: bestMatch.confidence,
        };
    }

    return bestMatch;
};

// ─── Smart Title Extractor ──────────────────────────────────────────────────

/**
 * Extract an intelligent title from content + classification.
 * Falls back to cleaned filename if content-based extraction fails.
 *
 * Examples:
 *   "scan_20240215.pdf" + content with "SBI" + "Account Statement" → "SBI Account Statement"
 *   "download(3).pdf" + content with "Aadhaar" → "Aadhaar Card"
 *   "My_Resume_2024.pdf" → "My Resume 2024" (cleaned filename)
 */
export const extractSmartTitle = (
    content: string,
    fileName: string,
    classification: ClassificationResult,
): string => {
    const cleanFileName = fileName.replace(/\.pdf$/i, '').trim();

    // Check if filename is a generic camera/scanner dump
    const isGenericName = /^(scan|download|img|image|doc\d|whatsapp|wa\d+)/i.test(cleanFileName);

    // Only try to override the title if the filename is garbage
    if (isGenericName) {
        if (classification.confidence > 40 && classification.category !== 'GENERAL_DOCUMENT') {
            const identifier = extractIdentifier(content, classification.category);
            if (identifier) {
                return `${classification.label} — ${identifier}`;
            }
        }

        if (content.length > 5) {
            const firstLine = content
                .split(/[\n\r]+/)
                .map(l => l.trim())
                .find(l => l.length > 8 && l.length < 60);

            if (firstLine) {
                // The title column is stored as-is (indexDocument only masks content),
                // so a first line like a PAN number or phone must be masked here.
                return maskSensitiveData(firstLine);
            }
        }
    }

    // Default to the actual filename (which is what users expect)
    return cleanFileName || 'Untitled Document';
};

/**
 * Extract a human-readable identifier from the content based on document type.
 * e.g., For BANK_STATEMENT → "SBI", for AADHAAR → "XXXX-XXXX-1234"
 */
const extractIdentifier = (content: string, category: DocumentCategory): string | null => {
    const lc = content.toLowerCase();

    switch (category) {
        case 'BANK_STATEMENT': {
            // Look for known bank names
            const banks = ['sbi', 'hdfc', 'icici', 'axis', 'kotak', 'pnb', 'bob', 'canara', 'union', 'idbi', 'yes bank', 'indusind'];
            const found = banks.find(b => lc.includes(b));
            return found ? found.toUpperCase() : null;
        }
        case 'AADHAAR_CARD': {
            // Look for 12-digit Aadhaar pattern (masked: XXXX XXXX 1234)
            const match = content.match(/\d{4}\s?\d{4}\s?\d{4}/);
            return match ? `****-****-${match[0].slice(-4)}` : null;
        }
        case 'INVOICE': {
            // Look for invoice number
            const match = content.match(/(?:invoice|inv)[\s#:]*([A-Z0-9-]+)/i);
            return match ? `#${match[1]}` : null;
        }
        case 'SALARY_SLIP': {
            // Look for month/year
            const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const found = months.find(m => lc.includes(m));
            const year = content.match(/20[12]\d/);
            if (found && year) return `${found.charAt(0).toUpperCase() + found.slice(1)} ${year[0]}`;
            return null;
        }
        default:
            return null;
    }
};
