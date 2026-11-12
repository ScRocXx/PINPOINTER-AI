import { Language, StringKey, StringParams, translate } from './strings';

/**
 * The app language, for code that runs outside React: permission pop-ups,
 * hooks that finish long after they started, background work.
 * `LanguageProvider` keeps it current; components use `useStrings()`.
 */
let current: Language = 'en';

export const setCurrentLanguage = (lang: Language): void => {
  current = lang;
};

export const getCurrentLanguage = (): Language => current;

/** The text for `key` in the language the app is showing right now. */
export const tNow = (key: StringKey, params?: StringParams): string => translate(current, key, params);
