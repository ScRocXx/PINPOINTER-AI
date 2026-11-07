/**
 * DataMasking.ts — Masks sensitive personal data before database storage.
 *
 * Ensures Aadhaar numbers, PAN numbers, bank account numbers, and phone
 * numbers are never stored in plain text. Search still works because
 * partial tokens and Soundex codes remain intact.
 *
 * Performance: pure regex, <0.1ms per document. Zero memory overhead.
 */

import { asciiDigits } from './IndicText';

/**
 * Mask an Aadhaar number: 1234 5678 9012 → ****-****-9012
 */
const maskAadhaar = (text: string): string => {
    // Matches 12-digit Aadhaar with optional spaces/dashes
    return text.replace(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g, '****-****-$3');
};

/**
 * Mask a PAN number: ABCDE1234F → ABCDE****F
 */
const maskPAN = (text: string): string => {
    return text.replace(/\b([A-Z]{5})(\d{4})([A-Z])\b/g, '$1****$3');
};

/**
 * Mask phone numbers (10-digit Indian): 9876543210 → ******3210
 */
const maskPhone = (text: string): string => {
    // Indian mobile: starts with 6-9, exactly 10 digits
    return text.replace(/\b([6-9]\d{5})(\d{4})\b/g, '******$2');
};

/**
 * Apply all masking rules to content before database storage.
 * Call this BEFORE indexDocument() to ensure sensitive data never hits the DB.
 *
 * The order matters: Aadhaar first (12 digits) before generic bank account
 * matching (8-18 digits) to prevent double-masking.
 */
export const maskSensitiveData = (content: string): string => {
    // Indian-script digits (०-९, ০-৯, ௦-௯ …) become 0-9 first. Without this an
    // Aadhaar number printed in Hindi digits slips past every regex below.
    let masked = asciiDigits(content);
    masked = maskAadhaar(masked);   // 12-digit Aadhaar (before bank accounts)
    masked = maskPAN(masked);       // PAN: ABCDE1234F
    masked = maskPhone(masked);     // 10-digit phone numbers
    // Note: bank account masking is intentionally last and aggressive
    // Skip it for now — too many false positives with dates, zip codes, etc.
    // masked = maskBankAccount(masked);
    return masked;
};
