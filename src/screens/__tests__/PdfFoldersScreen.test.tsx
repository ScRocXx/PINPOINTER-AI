/**
 * PdfFoldersScreen ("Where Pinpointer looks").
 *
 * usePdfPlaces is mocked, so each test says what the phone allows and which
 * folders were chosen; the actions are plain jest.fn()s. Navigation is
 * mocked wholesale.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { useNavigation } from '@react-navigation/native';
import { PdfFoldersScreen } from '../PdfFoldersScreen';
import { usePdfPlaces } from '../../hooks/usePdfPlaces';
import { translate } from '../../i18n/strings';

jest.mock('@react-navigation/native', () => ({ useNavigation: jest.fn() }));
jest.mock('../../hooks/usePdfPlaces', () => ({ usePdfPlaces: jest.fn() }));

type Vars = Record<string, string | number>;
const t = (key: Parameters<typeof translate>[1], vars?: Vars) => translate('en', key, vars);

const goBack = jest.fn();
const BILLS = { uri: 'content://tree/bills', name: 'Bills' };
const SCHOOL = { uri: 'content://tree/school', name: 'School' };

const places = {
  ready: true,
  standard: false,
  canAskStandard: true,
  canPick: true,
  folders: [] as { uri: string; name: string }[],
  refresh: jest.fn(),
  addFolder: jest.fn(async () => null),
  addFiles: jest.fn(async () => 0),
  removeFolder: jest.fn(async () => {}),
  allowStandard: jest.fn(async () => true),
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(places, { ready: true, standard: false, canAskStandard: true, canPick: true, folders: [] });
  (usePdfPlaces as jest.Mock).mockImplementation(() => places);
  (useNavigation as jest.Mock).mockReturnValue({ goBack });
});

describe('PdfFoldersScreen', () => {
  it('asks for an OK to read Downloads and Documents when it is off', async () => {
    await render(<PdfFoldersScreen />);
    expect(screen.getByRole('header', { name: t('papers.whereLooks') })).toBeTruthy();
    expect(within(screen.getByTestId('folders-downloads')).getByText(t('folders.needsPermission'))).toBeTruthy();
    expect(within(screen.getByTestId('folders-documents')).getByText(t('folders.needsPermission'))).toBeTruthy();
    expect(screen.getByTestId('folders-allow-card')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('folders-allow'));
    await waitFor(() => expect(places.allowStandard).toHaveBeenCalled());
  });

  it('shows "Looking here" and no Allow card once it is allowed', async () => {
    places.standard = true;
    await render(<PdfFoldersScreen />);
    expect(within(screen.getByTestId('folders-downloads')).getByText(t('folders.looking'))).toBeTruthy();
    expect(screen.queryByTestId('folders-allow-card')).toBeNull();
  });

  it('hides Downloads and Documents when this build cannot ask for them', async () => {
    places.canAskStandard = false;
    await render(<PdfFoldersScreen />);
    expect(screen.queryByTestId('folders-downloads')).toBeNull();
    expect(screen.queryByTestId('folders-allow-card')).toBeNull();
    expect(screen.getByTestId('folders-add')).toBeTruthy();
  });

  it('lists the folders the person chose', async () => {
    places.folders = [BILLS, SCHOOL];
    await render(<PdfFoldersScreen />);
    expect(within(screen.getByTestId('folders-folder-0')).getByText('Bills')).toBeTruthy();
    expect(within(screen.getByTestId('folders-folder-1')).getByText('School')).toBeTruthy();
    expect(screen.getByTestId('folders-remove-1').props.accessibilityLabel).toBe(t('folders.remove', { name: 'School' }));
    expect(screen.queryByTestId('folders-empty')).toBeNull();
  });

  it('says when no folders were chosen yet', async () => {
    await render(<PdfFoldersScreen />);
    expect(screen.getByText(t('folders.chosenEmpty'))).toBeTruthy();
  });

  it('asks before removing a folder, and Cancel keeps it', async () => {
    places.folders = [BILLS];
    await render(<PdfFoldersScreen />);
    await fireEvent.press(screen.getByTestId('folders-remove-0'));
    expect(screen.getByRole('header', { name: t('folders.removeTitle', { name: 'Bills' }) })).toBeTruthy();
    expect(screen.getByText(t('folders.removeBody'))).toBeTruthy();
    await fireEvent.press(screen.getByText(t('common.cancel')));
    expect(places.removeFolder).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('folders-remove-0'));
    await fireEvent.press(screen.getByTestId('folders-remove-confirm'));
    await waitFor(() => expect(places.removeFolder).toHaveBeenCalledWith(BILLS));
  });

  it('adds a folder or single PDFs', async () => {
    await render(<PdfFoldersScreen />);
    await fireEvent.press(screen.getByTestId('folders-add'));
    await waitFor(() => expect(places.addFolder).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('folders-pick'));
    await waitFor(() => expect(places.addFiles).toHaveBeenCalled());
  });

  it('makes "Add a folder" the main action once Downloads is allowed', async () => {
    places.standard = true;
    const { rerender } = await render(<PdfFoldersScreen />);
    const looking = JSON.stringify(screen.getByTestId('folders-add').props.style);
    places.standard = false;
    await rerender(<PdfFoldersScreen />);
    const asking = JSON.stringify(screen.getByTestId('folders-add').props.style);
    // While Downloads is off, Allow is the main action and "Add a folder"
    // steps back to the outlined secondary look.
    expect(asking).toContain('"borderWidth":1.5');
    expect(looking).not.toContain('"borderWidth":1.5');
  });

  it('shows only the privacy line when this phone has no pickers', async () => {
    places.canPick = false;
    await render(<PdfFoldersScreen />);
    expect(screen.queryByTestId('folders-add')).toBeNull();
    expect(screen.queryByTestId('folders-pick')).toBeNull();
    expect(screen.getByText(t('folders.private'))).toBeTruthy();
  });

  it('goes back', async () => {
    await render(<PdfFoldersScreen />);
    await fireEvent.press(screen.getByLabelText(t('common.back')));
    expect(goBack).toHaveBeenCalled();
  });
});
