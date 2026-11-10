import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Language,
  StringKey,
  StringParams,
  languageFromLocale,
  relativeTime,
  translate,
} from './strings';
import { AppLogger } from '../utils/AppLogger';

export const LANGUAGE_STORAGE_KEY = 'pinpointer.language';

export interface StringsApi {
  lang: Language;
  /** The text for `key` in the current language. */
  t: (key: StringKey, params?: StringParams) => string;
  /** "2 hours ago" in the current language. */
  ago: (timestamp: number | null | undefined) => string;
  setLang: (lang: Language) => void;
}

const deviceLanguage = (): Language => {
  try {
    const constants = I18nManager.getConstants?.() as { localeIdentifier?: string } | undefined;
    return languageFromLocale(constants?.localeIdentifier);
  } catch {
    return 'en';
  }
};

const makeApi = (lang: Language, setLang: (l: Language) => void): StringsApi => ({
  lang,
  t: (key, params) => translate(lang, key, params),
  ago: ts => relativeTime(lang, ts),
  setLang,
});

/** English, used when a component renders outside the provider (tests, previews). */
const FALLBACK: StringsApi = makeApi('en', () => {});

const LanguageCtx = createContext<StringsApi>(FALLBACK);

/**
 * Holds the app language. Starts in the phone's language (Hindi phones get
 * Hindi), then whatever the person picked last time.
 */
export const LanguageProvider: React.FC<{ children: React.ReactNode; initialLanguage?: Language }> = ({
  children,
  initialLanguage,
}) => {
  const [lang, setLangState] = useState<Language>(initialLanguage ?? deviceLanguage());

  useEffect(() => {
    if (initialLanguage) return;
    let alive = true;
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then(saved => {
        if (alive && (saved === 'en' || saved === 'hi')) setLangState(saved);
      })
      .catch(e => AppLogger.warn('Language', 'Could not read the saved language', e));
    return () => {
      alive = false;
    };
  }, [initialLanguage]);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next).catch(e =>
      AppLogger.warn('Language', 'Could not save the language', e),
    );
  }, []);

  const api = useMemo(() => makeApi(lang, setLang), [lang, setLang]);
  return <LanguageCtx.Provider value={api}>{children}</LanguageCtx.Provider>;
};

/** `const { t } = useStrings(); t('home.title')` */
export const useStrings = (): StringsApi => useContext(LanguageCtx);
