import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LANGUAGE_STORAGE_KEY, LanguageProvider, useStrings } from '../LanguageContext';
import { en, hi } from '../strings';

const Probe: React.FC = () => {
  const { lang, t, setLang, ago } = useStrings();
  return (
    <>
      <Text testID="lang">{lang}</Text>
      <Text testID="title">{t('tab.home')}</Text>
      <Text testID="never">{ago(null)}</Text>
      <Text testID="switch" onPress={() => setLang(lang === 'en' ? 'hi' : 'en')}>
        switch
      </Text>
    </>
  );
};

beforeEach(() => {
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
  jest.clearAllMocks();
});

describe('useStrings', () => {
  it('falls back to English without a provider', async () => {
    await render(<Probe />);
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(screen.getByTestId('title')).toHaveTextContent(en['tab.home']);
    expect(screen.getByTestId('never')).toHaveTextContent('never');
  });

  it('uses the initial language when given', async () => {
    await render(
      <LanguageProvider initialLanguage="hi">
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('title')).toHaveTextContent(hi['tab.home']);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('restores the saved language', async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, 'hi');
    await render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('hi'));
  });

  it('ignores a garbage saved value', async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    await render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('saves the choice when the language changes', async () => {
    await render(
      <LanguageProvider initialLanguage="en">
        <Probe />
      </LanguageProvider>,
    );
    await fireEvent.press(screen.getByTestId('switch'));
    expect(screen.getByTestId('lang')).toHaveTextContent('hi');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'hi');
  });
});
