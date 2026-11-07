/**
 * ConceptTable.ts — meaning IDs shared by English, Hindi, Hinglish and other
 * Indian languages, so "बिजली", "bijli" and "electricity" find each other
 * without any translation model.
 *
 * Every word of OCR text and of a query is looked up here. A hit adds a
 * concept token (e.g. `qcelectricity`) to the search index or the query.
 *
 * v1 seed: about 50 concepts for the documents and photos elderly users look
 * for (IDs, bills, medicine, money, family, festivals). Hindi entries are
 * reviewed; entries for other Indian languages are a starter set and need a
 * native speaker's check before release.
 *
 * Spelling variants are matched through the Bhasha key, so a list only needs
 * one or two common spellings per word.
 */
import { bhashaKey, containsIndic, normalizeIndic, romanize } from './IndicText';

export interface Concept {
    /** Stable id, lowercase a-z only. Becomes the token `qc<id>`. */
    id: string;
    /** English phrase given to the CLIP text encoder for this concept. */
    clip: string;
    /** Words in any script and spelling that mean this concept. */
    words: string[];
}

export const CONCEPTS: Concept[] = [
    // ── IDs and government documents ─────────────────────────────────────
    { id: 'aadhaar', clip: 'aadhaar identity card', words: ['aadhaar', 'aadhar', 'uidai', 'आधार'] },
    { id: 'pancard', clip: 'pan card', words: ['pancard', 'पैन', 'पैनकार्ड'] },
    { id: 'voterid', clip: 'voter id card', words: ['voter', 'epic', 'मतदाता', 'वोटर'] },
    { id: 'licence', clip: 'driving licence card', words: ['licence', 'license', 'driving', 'लाइसेंस', 'ड्राइविंग'] },
    { id: 'passport', clip: 'passport', words: ['passport', 'पासपोर्ट'] },
    { id: 'ration', clip: 'ration card', words: ['ration', 'राशन'] },
    { id: 'idcard', clip: 'identity card', words: ['identity', 'पहचान', 'pehchan'] },
    { id: 'certificate', clip: 'certificate document', words: ['certificate', 'प्रमाण', 'प्रमाणपत्र', 'सर्टिफिकेट', 'praman'] },
    { id: 'birth', clip: 'birth certificate', words: ['birth', 'जन्म', 'janam'] },
    { id: 'marksheet', clip: 'school marksheet', words: ['marksheet', 'marks', 'अंकपत्र', 'मार्कशीट'] },

    // ── Bills and money ──────────────────────────────────────────────────
    { id: 'bill', clip: 'a bill', words: ['bill', 'invoice', 'बिल', 'বিল', 'பில்', 'బిల్లు'] },
    { id: 'receipt', clip: 'a payment receipt', words: ['receipt', 'रसीद', 'पावती', 'raseed', 'rasid'] },
    { id: 'electricity', clip: 'electricity bill', words: ['electricity', 'electric', 'बिजली', 'वीज', 'bijli', 'বিদ্যুৎ', 'மின்சாரம்', 'విద్యుత్'] },
    { id: 'water', clip: 'water bill', words: ['water', 'पानी', 'जल', 'paani', 'pani', 'জল', 'தண்ணீர்', 'నీరు'] },
    { id: 'gas', clip: 'gas cylinder bill', words: ['gas', 'lpg', 'cylinder', 'गैस', 'सिलेंडर'] },
    { id: 'phone', clip: 'mobile phone', words: ['phone', 'mobile', 'recharge', 'फोन', 'फ़ोन', 'मोबाइल'] },
    { id: 'bank', clip: 'bank passbook', words: ['bank', 'passbook', 'account', 'statement', 'बैंक', 'खाता', 'पासबुक', 'khata'] },
    { id: 'money', clip: 'money and cash', words: ['money', 'cash', 'rupees', 'पैसा', 'पैसे', 'रुपये', 'रुपया', 'paisa', 'paise', 'rupaye'] },
    { id: 'payment', clip: 'payment screenshot', words: ['payment', 'paid', 'upi', 'gpay', 'phonepe', 'paytm', 'भुगतान'] },
    { id: 'salary', clip: 'salary slip', words: ['salary', 'payslip', 'वेतन', 'तनख्वाह', 'vetan', 'tankhwah'] },
    { id: 'pension', clip: 'pension document', words: ['pension', 'पेंशन'] },
    { id: 'tax', clip: 'tax document', words: ['tax', 'gst', 'itr', 'टैक्स'] },
    { id: 'insurance', clip: 'insurance policy', words: ['insurance', 'policy', 'बीमा', 'bima', 'beema'] },
    { id: 'property', clip: 'property papers', words: ['property', 'deed', 'registry', 'जमीन', 'ज़मीन', 'मकान', 'रजिस्ट्री', 'zameen', 'makaan'] },
    { id: 'rent', clip: 'rent agreement', words: ['rent', 'किराया', 'kiraya'] },
    { id: 'ticket', clip: 'travel ticket', words: ['ticket', 'pnr', 'irctc', 'टिकट', 'tikat'] },
    { id: 'train', clip: 'train ticket', words: ['train', 'railway', 'रेल', 'ट्रेन'] },

    // ── Health ───────────────────────────────────────────────────────────
    { id: 'medicine', clip: 'medicine tablets', words: ['medicine', 'medicines', 'tablet', 'tablets', 'capsule', 'दवा', 'दवाई', 'दवाइयाँ', 'औषध', 'गोली', 'dawa', 'dava', 'dawai', 'davai', 'dawaai', 'goli', 'ওষুধ', 'மருந்து', 'మందు', 'ಔಷಧ', 'દવા', 'ਦਵਾਈ', 'മരുന്ന്'] },
    { id: 'prescription', clip: 'doctor prescription', words: ['prescription', 'rx', 'पर्ची', 'नुस्खा', 'parchi'] },
    { id: 'doctor', clip: 'doctor', words: ['doctor', 'डॉक्टर', 'डाक्टर', 'वैद्य', 'daktar'] },
    { id: 'hospital', clip: 'hospital', words: ['hospital', 'clinic', 'अस्पताल', 'हॉस्पिटल', 'दवाखाना', 'aspatal'] },
    { id: 'report', clip: 'medical test report', words: ['report', 'lab', 'रिपोर्ट', 'जांच', 'जाँच', 'janch'] },

    // ── Family and life ──────────────────────────────────────────────────
    { id: 'family', clip: 'family photo', words: ['family', 'परिवार', 'parivar', 'pariwar'] },
    { id: 'mother', clip: 'mother', words: ['mother', 'mom', 'mummy', 'माँ', 'मां', 'माता', 'मम्मी', 'aai', 'maa'] },
    { id: 'father', clip: 'father', words: ['father', 'dad', 'papa', 'पिता', 'पापा', 'बाबूजी', 'pita', 'babuji'] },
    { id: 'grandmother', clip: 'grandmother', words: ['grandmother', 'grandma', 'दादी', 'नानी', 'आजी', 'dadi', 'nani'] },
    { id: 'grandfather', clip: 'grandfather', words: ['grandfather', 'grandpa', 'दादा', 'नाना', 'आजोबा', 'dada', 'nana'] },
    { id: 'child', clip: 'child', words: ['child', 'children', 'baby', 'kid', 'son', 'daughter', 'बच्चा', 'बच्चे', 'बेटा', 'बेटी', 'bachcha', 'beta', 'beti'] },
    { id: 'wedding', clip: 'wedding', words: ['wedding', 'marriage', 'शादी', 'विवाह', 'shaadi', 'vivah'] },
    { id: 'temple', clip: 'temple', words: ['temple', 'मंदिर', 'mandir', 'கோவில்', 'గుడి'] },
    { id: 'festival', clip: 'festival celebration', words: ['festival', 'puja', 'pooja', 'त्योहार', 'पूजा', 'tyohar'] },
    { id: 'diwali', clip: 'diwali lamps', words: ['diwali', 'deepavali', 'दिवाली', 'दीवाली', 'दीपावली'] },
    { id: 'holi', clip: 'holi colours', words: ['holi', 'होली'] },
    { id: 'home', clip: 'house', words: ['home', 'house', 'घर', 'ghar', 'বাড়ি', 'வீடு', 'ఇల్లు'] },
    { id: 'food', clip: 'food', words: ['food', 'meal', 'खाना', 'भोजन', 'khana'] },
    { id: 'vehicle', clip: 'car or scooter', words: ['vehicle', 'car', 'bike', 'scooter', 'गाड़ी', 'गाडी', 'वाहन', 'gaadi', 'gadi'] },
    { id: 'school', clip: 'school', words: ['school', 'college', 'स्कूल', 'विद्यालय', 'कॉलेज'] },
    { id: 'photo', clip: 'a photo', words: ['photo', 'selfie', 'picture', 'फोटो', 'तस्वीर', 'tasveer'] },
    { id: 'letter', clip: 'a letter', words: ['letter', 'पत्र', 'चिट्ठी', 'chitthi'] },
    { id: 'flower', clip: 'flower', words: ['flower', 'फूल', 'phool', 'ফুল', 'பூ'] },
    { id: 'tree', clip: 'tree', words: ['tree', 'पेड़', 'ped'] },
];

/**
 * Latin-script entries above that are Hindi words in Roman letters, not
 * English. They are swapped for the concept's English phrase before CLIP;
 * real English words go to CLIP as typed.
 */
const HINGLISH = new Set([
    'pehchan', 'praman', 'janam', 'raseed', 'rasid', 'bijli', 'paani', 'pani', 'khata',
    'paisa', 'paise', 'rupaye', 'vetan', 'tankhwah', 'bima', 'beema', 'zameen', 'makaan',
    'kiraya', 'tikat', 'dawa', 'dava', 'dawai', 'davai', 'dawaai', 'goli', 'parchi', 'daktar', 'aspatal', 'janch',
    'parivar', 'pariwar', 'aai', 'maa', 'pita', 'babuji', 'dadi', 'nani', 'dada', 'nana',
    'bachcha', 'beta', 'beti', 'shaadi', 'vivah', 'mandir', 'tyohar', 'ghar', 'khana',
    'gaadi', 'gadi', 'tasveer', 'chitthi', 'phool', 'ped',
]);

/** Token prefix for concept ids in the search index. */
export const CONCEPT_PREFIX = 'qc';

/** Keys shorter than this are too ambiguous to match a concept on sound alone. */
const MIN_KEY_LEN = 3;

/** Common Hindi plural and oblique endings, longest first. */
const HINDI_SUFFIXES = ['ियाँ', 'ियां', 'ियों', 'ाओं', 'ाएँ', 'ाएं', 'ुओं', 'ों', 'ें', 'ाँ', 'ां'];

const lowerForm = (w: string): string => normalizeIndic(w).toLowerCase();

const englishWords = new Set<string>();
const exactIndex = new Map<string, Set<string>>();
const keyIndex = new Map<string, Set<string>>();
const conceptById = new Map<string, Concept>();

const add = (map: Map<string, Set<string>>, k: string, id: string) => {
    if (!k) return;
    let set = map.get(k);
    if (!set) map.set(k, (set = new Set()));
    set.add(id);
};

for (const c of CONCEPTS) {
    conceptById.set(c.id, c);
    for (const w of c.words) {
        const f = lowerForm(w);
        add(exactIndex, f, c.id);
        if (!containsIndic(f) && !HINGLISH.has(f)) englishWords.add(f);
        if (containsIndic(f)) add(exactIndex, romanize(f), c.id);
        const k = bhashaKey(f);
        if (k.length >= MIN_KEY_LEN) add(keyIndex, k, c.id);
    }
}

const stemHindi = (w: string): string => {
    for (const s of HINDI_SUFFIXES) {
        if (w.length > s.length + 1 && w.endsWith(s)) return w.slice(0, -s.length);
    }
    return w;
};

/** Concept ids for one word in any script or spelling. */
export const conceptsForWord = (word: string): string[] => {
    const f = lowerForm(word);
    if (!f || /\d/.test(f)) return [];
    const hit = exactIndex.get(f)
        ?? (containsIndic(f) ? exactIndex.get(romanize(f)) ?? exactIndex.get(stemHindi(f)) : undefined);
    if (hit) return [...hit];
    const k = bhashaKey(f);
    const byKey = k.length >= MIN_KEY_LEN ? keyIndex.get(k) : undefined;
    return byKey ? [...byKey] : [];
};

/** Unique concept ids for every word of a text. */
export const conceptsForText = (words: string[]): string[] => {
    const seen = new Set<string>();
    for (const w of words) for (const id of conceptsForWord(w)) seen.add(id);
    return [...seen];
};

/**
 * Text to give the English-only CLIP text encoder for a query, or null when
 * the query should skip semantic search.
 *
 *  - Indian-script words are replaced by their concept's English phrase.
 *    Unknown Indian-script words are dropped: the English tokenizer would
 *    turn them into a meaningless vector.
 *  - Latin words that are a Hinglish spelling of a concept (dawai, bijli,
 *    or a misspelling with the same sound key) become English too; English
 *    words and unknown Latin words pass through as typed.
 */
export const clipTextForQuery = (query: string, words: string[]): string | null => {
    const parts: string[] = [];
    for (const w of words) {
        if (!containsIndic(w) && englishWords.has(w.toLowerCase())) {
            parts.push(w);
            continue;
        }
        const ids = conceptsForWord(w);
        if (ids.length > 0) {
            for (const id of ids) parts.push(conceptById.get(id)?.clip ?? id);
        } else if (!containsIndic(w)) {
            parts.push(w);
        }
    }
    const text = [...new Set(parts)].join(' ').trim();
    return text.length > 0 ? text : query.trim() && !containsIndic(query) ? query.trim() : null;
};
