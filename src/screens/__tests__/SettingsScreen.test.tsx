import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SettingsScreen } from '../SettingsScreen';
import { LanguageProvider, LANGUAGE_STORAGE_KEY, en, hi } from '../../i18n';
import { version } from '../../../package.json';

describe('SettingsScreen', () => {
  it('shows privacy and the version in plain words', async () => {
    await render(
      <LanguageProvider initialLanguage="en">
        <SettingsScreen />
      </LanguageProvider>,
    );
    expect(screen.getByRole('header', { name: en['settings.title'] })).toBeTruthy();
    expect(screen.getByText(en['settings.privacyBody'])).toBeTruthy();
    expect(screen.getByText(`Version ${version}`)).toBeTruthy();
  });

  it('switches the whole app to Hindi and remembers it', async () => {
    await render(
      <LanguageProvider initialLanguage="en">
        <SettingsScreen />
      </LanguageProvider>,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Hindi, हिन्दी' }));
    expect(screen.getByRole('header', { name: hi['settings.title'] })).toBeTruthy();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'hi');
    expect(screen.getByRole('radio', { name: 'Hindi, हिन्दी' }).props.accessibilityState).toMatchObject({ selected: true });
  });
});
