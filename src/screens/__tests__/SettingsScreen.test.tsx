import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SettingsScreen } from '../SettingsScreen';
import { LanguageProvider, LANGUAGE_STORAGE_KEY, en, hi } from '../../i18n';
import { version } from '../../../package.json';
import { DocumentAccessApi, PhotoAccessApi } from '../../hooks/useStorageAccess';

// `voice` is what the screens read; the two flags describe the model behind it.
const mockModels = {
  isSTTLoaded: true,
  isSTTLoading: false,
  downloadAndLoadSTT: jest.fn(async () => {}),
  get voice(): 'ready' | 'loading' | 'off' {
    return this.isSTTLoaded ? 'ready' : this.isSTTLoading ? 'loading' : 'off';
  },
};
jest.mock('../../services/ModelService', () => ({ useModelService: () => mockModels }));

const mockPhotos: PhotoAccessApi = {
  access: 'full',
  refresh: jest.fn(async () => 'full' as const),
  request: jest.fn(async () => 'full' as const),
  openSettings: jest.fn(async () => 'full' as const),
};
const mockDocs: DocumentAccessApi = {
  access: 'all',
  canAskAll: true,
  refresh: jest.fn(async () => 'all' as const),
  allowAll: jest.fn(async () => 'all' as const),
  chooseFolder: jest.fn(async () => true),
  pickFiles: jest.fn(async () => 1),
};
jest.mock('../../hooks/useStorageAccess', () => ({
  usePhotoAccess: () => mockPhotos,
  useDocumentAccess: () => mockDocs,
}));

const renderSettings = () =>
  render(
    <LanguageProvider initialLanguage="en">
      <SettingsScreen />
    </LanguageProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPhotos.access = 'full';
  mockDocs.access = 'all';
  mockDocs.canAskAll = true;
  mockModels.isSTTLoaded = true;
  mockModels.isSTTLoading = false;
});

describe('SettingsScreen', () => {
  it('shows privacy and the version in plain words', async () => {
    await renderSettings();
    expect(screen.getByRole('header', { name: en['settings.title'] })).toBeTruthy();
    expect(screen.getByText(en['settings.privacyBody'])).toBeTruthy();
    expect(screen.getByText(`Version ${version}`)).toBeTruthy();
  });

  it('switches the whole app to Hindi and remembers it', async () => {
    await renderSettings();
    await fireEvent.press(screen.getByRole('radio', { name: 'Hindi, हिन्दी' }));
    expect(screen.getByRole('header', { name: hi['settings.title'] })).toBeTruthy();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'hi');
    expect(screen.getByRole('radio', { name: 'Hindi, हिन्दी' }).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('what Pinpointer can see', () => {
  it('says all photos and all PDFs, and sends a change to Settings', async () => {
    await renderSettings();
    expect(screen.getByText(en['settings.photosAll'])).toBeTruthy();
    expect(screen.getByText(en['settings.papersAll'])).toBeTruthy();

    await fireEvent.press(screen.getByTestId('settings-photos'));
    expect(mockPhotos.openSettings).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('settings-papers'));
    expect(mockDocs.allowAll).toHaveBeenCalledTimes(1);
  });

  it('offers all photos when only some are allowed, through Android’s own dialog', async () => {
    mockPhotos.access = 'limited';
    await renderSettings();
    expect(screen.getByText(en['settings.photosSome'])).toBeTruthy();
    await fireEvent.press(screen.getByTestId('settings-photos'));
    expect(mockPhotos.request).toHaveBeenCalledTimes(1);
    expect(mockPhotos.openSettings).not.toHaveBeenCalled();
  });

  it('goes to Settings when Android won’t ask again', async () => {
    mockPhotos.access = 'blocked';
    await renderSettings();
    expect(screen.getByText(en['settings.photosOff'])).toBeTruthy();
    await fireEvent.press(screen.getByTestId('settings-photos'));
    expect(mockPhotos.openSettings).toHaveBeenCalledTimes(1);
  });

  it('offers a folder when this build can’t ask for all files', async () => {
    mockDocs.access = 'folders';
    mockDocs.canAskAll = false;
    await renderSettings();
    expect(screen.getByText(en['settings.papersFolders'])).toBeTruthy();
    await fireEvent.press(screen.getByTestId('settings-papers'));
    expect(mockDocs.chooseFolder).toHaveBeenCalledTimes(1);
    expect(mockDocs.allowAll).not.toHaveBeenCalled();
  });

  it('shows nothing under a row while still checking', async () => {
    mockPhotos.access = null;
    mockDocs.access = null;
    await renderSettings();
    expect(screen.queryByText(en['settings.photosOff'])).toBeNull();
    expect(screen.queryByText(en['settings.papersOff'])).toBeNull();
  });
});

describe('voice and photo search', () => {
  it('opens the helper sheet, which never opened before', async () => {
    await renderSettings();
    expect(screen.getByText(en['settings.helpersReady'])).toBeTruthy();
    expect(screen.queryByTestId('model-sheet')).toBeNull();

    await fireEvent.press(screen.getByTestId('settings-helpers'));
    await act(async () => {});
    expect(screen.getByTestId('model-sheet')).toBeTruthy();
    expect(screen.getByRole('header', { name: en['models.title'] })).toBeTruthy();
    expect(screen.getByText(en['models.voiceBody'])).toBeTruthy();
  });

  it('says when voice search is loading or broken', async () => {
    mockModels.isSTTLoaded = false;
    mockModels.isSTTLoading = true;
    const { rerender } = await renderSettings();
    expect(screen.getByText(en['settings.helpersLoading'])).toBeTruthy();

    mockModels.isSTTLoading = false;
    await rerender(
      <LanguageProvider initialLanguage="en">
        <SettingsScreen />
      </LanguageProvider>,
    );
    expect(screen.getByText(en['settings.helpersOff'])).toBeTruthy();
  });
});
