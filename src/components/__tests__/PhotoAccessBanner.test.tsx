import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PhotoAccessBanner } from '../PhotoAccessBanner';
import { LanguageProvider, en } from '../../i18n';
import { PhotoAccessApi } from '../../hooks/useStorageAccess';
import { isLimitedAccessKept, keepLimitedAccess } from '../../utils/StoragePermissions';

const mockPhotos: PhotoAccessApi = {
  access: 'limited',
  refresh: jest.fn(async () => 'limited' as const),
  request: jest.fn(async () => 'limited' as const),
  openSettings: jest.fn(async () => 'full' as const),
};
jest.mock('../../hooks/useStorageAccess', () => ({ usePhotoAccess: () => mockPhotos }));
jest.mock('../../utils/StoragePermissions', () => ({
  isLimitedAccessKept: jest.fn(async () => false),
  keepLimitedAccess: jest.fn(async () => {}),
}));

const renderBanner = async (props: React.ComponentProps<typeof PhotoAccessBanner> = {}) => {
  const view = await render(
    <LanguageProvider initialLanguage="en">
      <PhotoAccessBanner {...props} />
    </LanguageProvider>,
  );
  await act(async () => {});
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPhotos.access = 'limited';
  (isLimitedAccessKept as jest.Mock).mockResolvedValue(false);
});

describe('PhotoAccessBanner', () => {
  it('shows only while some photos, not all, are allowed', async () => {
    await renderBanner();
    expect(screen.getByText(en['perm.limitedTitle'])).toBeTruthy();
    expect(screen.getByText(en['perm.limitedBody'])).toBeTruthy();
  });

  it.each(['full', 'denied', 'blocked', null] as const)('stays hidden with %s access', async access => {
    mockPhotos.access = access;
    await renderBanner();
    expect(screen.queryByTestId('photo-access-banner')).toBeNull();
  });

  it('stays hidden once the person chose to keep their choice', async () => {
    (isLimitedAccessKept as jest.Mock).mockResolvedValue(true);
    await renderBanner();
    expect(screen.queryByTestId('photo-access-banner')).toBeNull();
  });

  it('asks Android first, then points to Settings if that didn’t give all photos', async () => {
    const onAccessChange = jest.fn();
    await renderBanner({ onAccessChange });

    await fireEvent.press(screen.getByTestId('photo-access-banner-allow'));
    await act(async () => {});
    expect(mockPhotos.request).toHaveBeenCalledTimes(1);
    expect(onAccessChange).toHaveBeenLastCalledWith('limited');
    expect(screen.getByText(en['perm.limitedSettingsBody'])).toBeTruthy();
    expect(screen.getByText(en['perm.openSettings'])).toBeTruthy();

    await fireEvent.press(screen.getByTestId('photo-access-banner-allow'));
    await act(async () => {});
    expect(mockPhotos.openSettings).toHaveBeenCalledTimes(1);
    expect(onAccessChange).toHaveBeenLastCalledWith('full');
  });

  it('“Keep my choice” hides it and remembers that', async () => {
    await renderBanner();
    await fireEvent.press(screen.getByLabelText(en['perm.keepChoice']));
    expect(keepLimitedAccess).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('photo-access-banner')).toBeNull();
  });
});
