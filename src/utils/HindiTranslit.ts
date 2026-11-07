/**
 * DETERMINISTIC HINDI TRANSLITERATOR
 *
 * Converts Devanagari text to Hinglish (Romanized Hindi) using a character map.
 * Devanagari is a phonetic script, so this mapping is 100% accurate — no LLM needed.
 *
 * Also provides an English keyword lookup for common words to enable full cross-lingual search.
 */
import { romanize } from './IndicText';

// ─── Devanagari → Latin ──────────────────────────────────────────────────────
// Delegates to the shared Indian-script romanizer (IndicText.ts), which also
// fixes the old map's bugs: word-final schwa (कमल → kamal), 3-code-point
// conjuncts (क्ष, त्र, ज्ञ), nukta letters and Indian digits.

/**
 * Converts Indian-script text (Devanagari and 8 other scripts) to Hinglish.
 * e.g. "कमल" → "kamal", "आधार" → "aadhaar", "घर" → "ghar"
 */
export const transliterate = (text: string): string => romanize(text);

// ─── Common Hindi word → English translation dictionary ───────────────────────
// Covers the most frequently searched topics. Expand as needed.

const HINDI_DICT: Record<string, string> = {
    // Nature / Plants
    'कमल': 'lotus flower', 'गुलाब': 'rose flower', 'पत्ता': 'leaf',
    'पेड़': 'tree', 'फूल': 'flower', 'नदी': 'river',
    'पहाड़': 'mountain hill', 'आसमान': 'sky', 'सूरज': 'sun',
    'चाँद': 'moon', 'तारा': 'star', 'बादल': 'cloud',
    'बारिश': 'rain', 'पानी': 'water', 'आग': 'fire',

    // People & Relations
    'माँ': 'mother mom', 'पिता': 'father dad', 'भाई': 'brother',
    'बहन': 'sister', 'बच्चा': 'child baby', 'दोस्त': 'friend',
    'परिवार': 'family', 'लड़का': 'boy man', 'लड़की': 'girl woman',

    // Places
    'घर': 'home house', 'स्कूल': 'school', 'अस्पताल': 'hospital',
    'बाजार': 'market', 'मंदिर': 'temple', 'मस्जिद': 'mosque',
    'शहर': 'city', 'गाँव': 'village', 'सड़क': 'road street',

    // Documents / ID
    'आधार': 'aadhaar id card', 'पासपोर्ट': 'passport', 'नाम': 'name',
    'पता': 'address', 'जन्म': 'birth date', 'फोन': 'phone mobile',
    'ईमेल': 'email',

    // Food
    'खाना': 'food meal eat', 'चाय': 'tea', 'दूध': 'milk',
    'रोटी': 'bread roti', 'चावल': 'rice', 'दाल': 'lentil dal',
    'सब्जी': 'vegetable', 'फल': 'fruit', 'मिठाई': 'sweets dessert',

    // Common adjectives / general
    'बड़ा': 'big large', 'छोटा': 'small little', 'अच्छा': 'good nice',
    'बुरा': 'bad', 'नया': 'new', 'पुराना': 'old',
    'लाल': 'red', 'नीला': 'blue', 'हरा': 'green',
    'सफेद': 'white', 'काला': 'black', 'पीला': 'yellow',

    // Numbers / Time
    'एक': 'one', 'दो': 'two', 'तीन': 'three', 'चार': 'four', 'पाँच': 'five',
    'आज': 'today', 'कल': 'tomorrow yesterday', 'अभी': 'now',
    'सुबह': 'morning', 'शाम': 'evening', 'रात': 'night',

    // Actions
    'जाना': 'go', 'आना': 'come', 'देखना': 'see look',
    'पीना': 'drink', 'पढ़ना': 'read', 'लिखना': 'write', 'बोलना': 'speak say',
};

/**
 * Look up English translations for all known words in a Hindi string.
 * Returns a space-separated string of English keywords.
 * e.g. "कमल घर" → "lotus flower home house"
 */
export const lookupEnglish = (text: string): string => {
    const words = text.split(/[\s,।]+/).filter(Boolean);
    const englishKeys: string[] = [];
    for (const word of words) {
        const translation = HINDI_DICT[word.trim()];
        if (translation) englishKeys.push(translation);
    }
    return englishKeys.join(' ');
};

/**
 * Detect if a string contains Devanagari characters.
 */
export const containsDevanagari = (text: string): boolean =>
    /[\u0900-\u097F]/.test(text);

/**
 * Full enrichment pipeline — deterministic, zero LLM, instant.
 *
 *  Input:  "कमल" (OCR output)
 *  Output: "कमल kamal lotus flower"
 *
 *  Input:  "आधार कार्ड"
 *  Output: "आधार कार्ड aadhaar kaard aadhaar id card"
 */
export const enrichHindi = (text: string): string => {
    const hinglish = transliterate(text);   // "kamal"  rule-based (IndicText.romanize)
    const english = lookupEnglish(text);   // "lotus flower"  from dict
    return [text.trim(), hinglish, english].filter(Boolean).join(' ').trim();
};
