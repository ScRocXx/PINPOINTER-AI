/**
 * Every word the app shows, in English and Hindi.
 *
 * Plain words only. The old screens used jargon; use these instead:
 *   "Universal Sync" / "Index Entire Device" → "Look through all photos"
 *   "Scan Images" / "Scan docs" (indexing)   → "Find new photos" / "Find new papers"
 *   "Analyzing images on-device"             → "Getting your photos ready"
 *   "Doc Vault" / "Document Vault"           → "Papers"
 *   "Smart Clipboard" / "Image to Text"      → "Read text from a photo" (tab: "Scan")
 *   "OCR" / "Extracted Text"                 → "Text in this photo" / "Text found"
 *   "AI-Classified", "Privacy-First On-Device AI" → drop it, or "On this phone"
 *   "Sync", "Index"                          → "Check", "Get ready"
 *
 * Keys are grouped by screen. `{name}` placeholders are filled by `t()`.
 * The Hindi was written for review by a native speaker before launch.
 */
export const en = {
  // Tabs
  'tab.home': 'Home',
  'tab.photos': 'Photos',
  'tab.scan': 'Scan',
  'tab.scanLabel': 'Scan: read text from a photo',
  'tab.papers': 'Papers',
  'tab.settings': 'Settings',

  // Common
  'common.back': 'Back',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.notNow': 'Not now',
  'common.seeAll': 'See all',
  'common.tryAgain': 'Try again',
  'common.share': 'Share',
  'common.copyText': 'Copy text',
  'common.copied': 'Text copied',
  'common.important': 'Important',
  'common.gallery': 'Gallery',
  'common.remove': 'Remove',
  'common.onThisPhone': 'On this phone',
  'common.more': 'More options',
  'common.loading': 'Loading',

  // Home
  'home.greetingMorning': 'Good morning',
  'home.greetingAfternoon': 'Good afternoon',
  'home.greetingEvening': 'Good evening',
  'home.title': 'What are you looking for?',
  'home.searchHint': 'Try “Aadhaar” or “bijli bill”',
  'home.findQuickly': 'Find quickly',
  'home.important': 'Important',
  'home.importantEmpty': 'Tap the star on any photo to keep it here.',
  'home.recent': 'Recently opened',

  // Quick collections on Home
  'collection.id': 'ID cards',
  'collection.bills': 'Bills',
  'collection.medicine': 'Medicine',
  'collection.bank': 'Bank',
  'collection.screenshots': 'Screenshots',
  'collection.family': 'Family',
  'collection.count': '{n} found',

  // Getting ready (indexing)
  'progress.photosTitle': 'Getting your photos ready',
  'progress.papersTitle': 'Getting your papers ready',
  'progress.count': '{done} of {total} · you can search now',
  'progress.countShort': '{done} of {total}',
  'progress.allPhotosReady': 'All {total} photos ready',
  'progress.allPapersReady': 'All {total} papers ready',
  'progress.checked': 'Checked {when}',
  'progress.checkAgain': 'Check again',
  'progress.findNewPhotos': 'Find new photos',
  'progress.findNewPapers': 'Find new papers',
  'progress.paused': 'Paused',
  'progress.pause': 'Pause',
  'progress.resume': 'Resume',
  'progress.keepsGoing': 'Keeps going while charging',
  'progress.keepsGoingBody': 'Even when the app is closed',

  // Relative time
  'time.never': 'never',
  'time.justNow': 'just now',
  'time.minutesAgo': '{n} min ago',
  'time.hoursAgo': '{n} hours ago',
  'time.oneHourAgo': '1 hour ago',
  'time.yesterday': 'yesterday',
  'time.daysAgo': '{n} days ago',

  // Search
  'search.placeholder': 'Search photos and papers',
  'search.clear': 'Clear search',
  'search.voice': 'Search by voice',
  'search.stopVoice': 'Stop listening',
  'search.listening': 'Listening… tap to stop',
  'search.understanding': 'Understanding…',
  'search.filterAll': 'All',
  'search.filterPhotos': 'Photos',
  'search.filterPapers': 'Papers',
  'search.alsoSearched': 'Also searched',
  'search.recent': 'Recent searches',
  'search.clearHistory': 'Clear all',
  'search.removeHistory': 'Remove {q} from recent searches',
  'search.noHistory': 'Your searches will show here.',
  'search.nothingTitle': 'Nothing found for “{q}” yet',
  'search.nothingBody': 'Try another word, or look through all your photos.',
  'search.lookEverywhere': 'Look through all photos',
  'search.showMore': 'Show {n} more',
  'search.textMatch': 'Words match',
  'search.looksLike': 'Looks similar',
  'search.foundHere': 'Found “{q}” here',
  'search.photo': 'Photo',
  'search.paper': 'Paper',

  // Photo viewer
  'viewer.photo': 'Photo',
  'viewer.position': '{i} of {n}',
  'viewer.textInPhoto': 'Text in this photo',
  'viewer.noText': 'No words found in this photo.',
  'viewer.hiddenNumbers': 'ID numbers are hidden for safety',
  'viewer.markImportant': 'Mark as important',
  'viewer.unmarkImportant': 'Remove from important',

  // Papers
  'papers.title': 'Papers',
  'papers.count': '{n} papers on this phone',
  'papers.whereLooks': 'Where Pinpointer looks',
  'papers.recent': 'Recent papers',
  'papers.add': 'Add a folder or PDF',
  'papers.emptyTitle': 'No papers yet',
  'papers.emptyBody': 'Pinpointer looks for PDFs in Downloads and Documents, and in folders you choose.',
  'papers.pages': '{n} pages',
  'papers.onePage': '1 page',
  'papers.cat.id': 'ID cards',
  'papers.cat.bills': 'Bills',
  'papers.cat.bank': 'Bank',
  'papers.cat.medical': 'Medical',
  'papers.cat.tax': 'Tax',
  'papers.cat.other': 'Other',

  // Read text from a photo (Scan)
  'scan.title': 'Read text from a photo',
  'scan.takePhoto': 'Take a photo',
  'scan.pickPhoto': 'Pick from gallery',
  'scan.reading': 'Reading the text…',
  'scan.textFound': 'Text found',
  'scan.noTextTitle': 'No words found',
  'scan.noTextBody': 'Try a clearer photo, with the paper flat and in good light.',
  'scan.another': 'Scan another',
  'scan.languages': 'Hindi + English',

  // First run
  'onboarding.welcomeTitle': 'Find any photo or paper in seconds',
  'onboarding.welcomeBody':
    'Type or say what you need, like “Aadhaar”, “bijli bill” or “dawai”. Pinpointer reads the words in your photos and PDFs to find it.',
  'onboarding.private': 'Works without internet. Nothing leaves your phone.',
  'onboarding.start': 'Get started',
  'onboarding.photosTitle': 'Let Pinpointer look at your photos',
  'onboarding.photosBody': 'So it can find the bill, ID card or medicine strip you took a photo of.',
  'onboarding.photosPoint1': 'It reads the words in your photos, right here on your phone.',
  'onboarding.photosPoint2': 'It never uploads, changes or deletes a photo.',
  'onboarding.photosPoint3': 'You can change this any time in Settings.',
  'onboarding.allowPhotos': 'Allow photos',
  'onboarding.readyBody': 'You can start searching now. More photos become findable every minute.',
  'onboarding.startSearching': 'Start searching',
  'onboarding.step': 'Step {i} of {n}',

  // Permissions
  'perm.limitedTitle': 'Pinpointer can see only some photos',
  'perm.limitedBody': 'Allow all photos so nothing is missed.',
  'perm.allowAll': 'Allow all photos',
  'perm.openSettings': 'Open Settings',
  'perm.micBody': 'To search by voice, allow the microphone.',

  // Settings
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.privacy': 'Privacy',
  'settings.privacyBody': 'Pinpointer works without internet. Your photos and papers never leave this phone.',
  'settings.about': 'About Pinpointer',
  'settings.version': 'Version {v}',

  // Languages (always shown in their own script)
  'lang.en': 'English',
  'lang.hi': 'हिन्दी',

  // Errors
  'error.generic': 'Something went wrong. Please try again.',
  'error.fileGone': 'This file is no longer on your phone.',
} as const;

export type StringKey = keyof typeof en;

export const hi: Record<StringKey, string> = {
  'tab.home': 'होम',
  'tab.photos': 'फ़ोटो',
  'tab.scan': 'स्कैन',
  'tab.scanLabel': 'स्कैन: फ़ोटो से टेक्स्ट पढ़ें',
  'tab.papers': 'कागज़',
  'tab.settings': 'सेटिंग्स',

  'common.back': 'वापस',
  'common.close': 'बंद करें',
  'common.cancel': 'रद्द करें',
  'common.done': 'हो गया',
  'common.notNow': 'अभी नहीं',
  'common.seeAll': 'सब देखें',
  'common.tryAgain': 'फिर से कोशिश करें',
  'common.share': 'शेयर करें',
  'common.copyText': 'टेक्स्ट कॉपी करें',
  'common.copied': 'टेक्स्ट कॉपी हो गया',
  'common.important': 'ज़रूरी',
  'common.gallery': 'गैलरी',
  'common.remove': 'हटाएँ',
  'common.onThisPhone': 'इसी फ़ोन पर',
  'common.more': 'और विकल्प',
  'common.loading': 'लोड हो रहा है',

  'home.greetingMorning': 'सुप्रभात',
  'home.greetingAfternoon': 'नमस्ते',
  'home.greetingEvening': 'शुभ संध्या',
  'home.title': 'आप क्या ढूँढ रहे हैं?',
  'home.searchHint': '“आधार” या “बिजली बिल” लिखकर देखें',
  'home.findQuickly': 'जल्दी ढूँढें',
  'home.important': 'ज़रूरी',
  'home.importantEmpty': 'किसी भी फ़ोटो पर तारा दबाएँ, वह यहाँ दिखेगी।',
  'home.recent': 'हाल ही में खोली गईं',

  'collection.id': 'पहचान पत्र',
  'collection.bills': 'बिल',
  'collection.medicine': 'दवाई',
  'collection.bank': 'बैंक',
  'collection.screenshots': 'स्क्रीनशॉट',
  'collection.family': 'परिवार',
  'collection.count': '{n} मिले',

  'progress.photosTitle': 'आपकी फ़ोटो तैयार हो रही हैं',
  'progress.papersTitle': 'आपके कागज़ तैयार हो रहे हैं',
  'progress.count': '{total} में से {done} · अभी भी खोज सकते हैं',
  'progress.countShort': '{total} में से {done}',
  'progress.allPhotosReady': 'सभी {total} फ़ोटो तैयार',
  'progress.allPapersReady': 'सभी {total} कागज़ तैयार',
  'progress.checked': '{when} जाँचा गया',
  'progress.checkAgain': 'फिर से जाँचें',
  'progress.findNewPhotos': 'नई फ़ोटो ढूँढें',
  'progress.findNewPapers': 'नए कागज़ ढूँढें',
  'progress.paused': 'रुका हुआ',
  'progress.pause': 'रोकें',
  'progress.resume': 'फिर शुरू करें',
  'progress.keepsGoing': 'चार्जिंग के समय चलता रहता है',
  'progress.keepsGoingBody': 'ऐप बंद होने पर भी',

  'time.never': 'कभी नहीं',
  'time.justNow': 'अभी-अभी',
  'time.minutesAgo': '{n} मिनट पहले',
  'time.hoursAgo': '{n} घंटे पहले',
  'time.oneHourAgo': '1 घंटा पहले',
  'time.yesterday': 'कल',
  'time.daysAgo': '{n} दिन पहले',

  'search.placeholder': 'फ़ोटो और कागज़ खोजें',
  'search.clear': 'खोज मिटाएँ',
  'search.voice': 'बोलकर खोजें',
  'search.stopVoice': 'सुनना बंद करें',
  'search.listening': 'सुन रहे हैं… रोकने के लिए दबाएँ',
  'search.understanding': 'समझ रहे हैं…',
  'search.filterAll': 'सब',
  'search.filterPhotos': 'फ़ोटो',
  'search.filterPapers': 'कागज़',
  'search.alsoSearched': 'यह भी खोजा',
  'search.recent': 'हाल की खोजें',
  'search.clearHistory': 'सब मिटाएँ',
  'search.removeHistory': 'हाल की खोजों से {q} हटाएँ',
  'search.noHistory': 'आपकी खोजें यहाँ दिखेंगी।',
  'search.nothingTitle': '“{q}” के लिए अभी कुछ नहीं मिला',
  'search.nothingBody': 'कोई और शब्द आज़माएँ, या अपनी सारी फ़ोटो देखें।',
  'search.lookEverywhere': 'सारी फ़ोटो देखें',
  'search.showMore': '{n} और दिखाएँ',
  'search.textMatch': 'शब्द मिले',
  'search.looksLike': 'मिलती-जुलती',
  'search.foundHere': '“{q}” यहाँ मिला',
  'search.photo': 'फ़ोटो',
  'search.paper': 'कागज़',

  'viewer.photo': 'फ़ोटो',
  'viewer.position': '{n} में से {i}',
  'viewer.textInPhoto': 'इस फ़ोटो में लिखा है',
  'viewer.noText': 'इस फ़ोटो में कोई शब्द नहीं मिला।',
  'viewer.hiddenNumbers': 'सुरक्षा के लिए ID नंबर छिपाए गए हैं',
  'viewer.markImportant': 'ज़रूरी में रखें',
  'viewer.unmarkImportant': 'ज़रूरी से हटाएँ',

  'papers.title': 'कागज़',
  'papers.count': 'इस फ़ोन पर {n} कागज़',
  'papers.whereLooks': 'Pinpointer कहाँ देखता है',
  'papers.recent': 'हाल के कागज़',
  'papers.add': 'फ़ोल्डर या PDF जोड़ें',
  'papers.emptyTitle': 'अभी कोई कागज़ नहीं',
  'papers.emptyBody': 'Pinpointer डाउनलोड और डॉक्यूमेंट्स में, और आपके चुने फ़ोल्डरों में PDF ढूँढता है।',
  'papers.pages': '{n} पेज',
  'papers.onePage': '1 पेज',
  'papers.cat.id': 'पहचान पत्र',
  'papers.cat.bills': 'बिल',
  'papers.cat.bank': 'बैंक',
  'papers.cat.medical': 'दवाई और इलाज',
  'papers.cat.tax': 'टैक्स',
  'papers.cat.other': 'अन्य',

  'scan.title': 'फ़ोटो से टेक्स्ट पढ़ें',
  'scan.takePhoto': 'फ़ोटो लें',
  'scan.pickPhoto': 'गैलरी से चुनें',
  'scan.reading': 'टेक्स्ट पढ़ रहे हैं…',
  'scan.textFound': 'मिला हुआ टेक्स्ट',
  'scan.noTextTitle': 'कोई शब्द नहीं मिला',
  'scan.noTextBody': 'साफ़ फ़ोटो लेकर देखें, कागज़ सीधा और रोशनी अच्छी हो।',
  'scan.another': 'दूसरी स्कैन करें',
  'scan.languages': 'हिंदी + अंग्रेज़ी',

  'onboarding.welcomeTitle': 'कोई भी फ़ोटो या कागज़ पल भर में ढूँढें',
  'onboarding.welcomeBody':
    'जो चाहिए वह लिखें या बोलें, जैसे “आधार”, “बिजली बिल” या “दवाई”। Pinpointer आपकी फ़ोटो और PDF में लिखे शब्द पढ़कर उसे ढूँढता है।',
  'onboarding.private': 'इंटरनेट के बिना चलता है। कुछ भी आपके फ़ोन से बाहर नहीं जाता।',
  'onboarding.start': 'शुरू करें',
  'onboarding.photosTitle': 'Pinpointer को अपनी फ़ोटो देखने दें',
  'onboarding.photosBody': 'ताकि वह आपकी खींची हुई बिल, ID कार्ड या दवाई की पत्ती की फ़ोटो ढूँढ सके।',
  'onboarding.photosPoint1': 'यह आपकी फ़ोटो में लिखे शब्द यहीं आपके फ़ोन पर पढ़ता है।',
  'onboarding.photosPoint2': 'यह कभी कोई फ़ोटो अपलोड नहीं करता, न बदलता है, न मिटाता है।',
  'onboarding.photosPoint3': 'आप इसे कभी भी सेटिंग्स में बदल सकते हैं।',
  'onboarding.allowPhotos': 'फ़ोटो की अनुमति दें',
  'onboarding.readyBody': 'आप अभी से खोज सकते हैं। हर मिनट और फ़ोटो खोजने लायक हो जाती हैं।',
  'onboarding.startSearching': 'खोजना शुरू करें',
  'onboarding.step': '{n} में से चरण {i}',

  'perm.limitedTitle': 'Pinpointer सिर्फ़ कुछ फ़ोटो देख सकता है',
  'perm.limitedBody': 'सारी फ़ोटो की अनुमति दें ताकि कुछ न छूटे।',
  'perm.allowAll': 'सारी फ़ोटो की अनुमति दें',
  'perm.openSettings': 'सेटिंग्स खोलें',
  'perm.micBody': 'बोलकर खोजने के लिए माइक्रोफ़ोन की अनुमति दें।',

  'settings.title': 'सेटिंग्स',
  'settings.language': 'भाषा',
  'settings.privacy': 'गोपनीयता',
  'settings.privacyBody': 'Pinpointer इंटरनेट के बिना चलता है। आपकी फ़ोटो और कागज़ कभी इस फ़ोन से बाहर नहीं जाते।',
  'settings.about': 'Pinpointer के बारे में',
  'settings.version': 'संस्करण {v}',

  'lang.en': 'English',
  'lang.hi': 'हिन्दी',

  'error.generic': 'कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।',
  'error.fileGone': 'यह फ़ाइल अब आपके फ़ोन पर नहीं है।',
};

export type Language = 'en' | 'hi';

export const DICTIONARIES: Record<Language, Record<StringKey, string>> = { en, hi };

export type StringParams = Record<string, string | number>;

/** Indian digit grouping: 124000 → "1,24,000". */
export const formatCount = (n: number): string => {
  try {
    return n.toLocaleString('en-IN');
  } catch {
    return String(n);
  }
};

/**
 * Look up `key` in `lang` (falling back to English) and fill `{name}`
 * placeholders. Numbers are formatted with Indian grouping.
 */
export const translate = (lang: Language, key: StringKey, params?: StringParams): string => {
  const template = DICTIONARIES[lang]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? formatCount(value) : value;
  });
};

/** Device language → app language. Hindi phones start in Hindi. */
export const languageFromLocale = (locale: string | undefined | null): Language =>
  locale && locale.toLowerCase().startsWith('hi') ? 'hi' : 'en';

/**
 * "2 hours ago" style text for a timestamp, in `lang`.
 * `now` is injectable for tests.
 */
export const relativeTime = (lang: Language, timestamp: number | null | undefined, now: number = Date.now()): string => {
  if (!timestamp) return translate(lang, 'time.never');
  const secs = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (secs < 60) return translate(lang, 'time.justNow');
  if (secs < 3600) return translate(lang, 'time.minutesAgo', { n: Math.floor(secs / 60) });
  if (secs < 7200) return translate(lang, 'time.oneHourAgo');
  if (secs < 86400) return translate(lang, 'time.hoursAgo', { n: Math.floor(secs / 3600) });
  const days = Math.floor(secs / 86400);
  return days === 1 ? translate(lang, 'time.yesterday') : translate(lang, 'time.daysAgo', { n: days });
};
