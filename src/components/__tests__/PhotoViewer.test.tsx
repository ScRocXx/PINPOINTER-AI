/**
 * PhotoViewer: the shared photo viewer (Photos tab, search results).
 *
 * The database lookup is mocked so each test decides what Pinpointer has
 * "read" in the photo. Starring goes through the real PinnedItems store on
 * the in-memory AsyncStorage mock.
 */
import React from 'react';
import { Linking, NativeModules, Platform, Share } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PhotoViewer, ViewerItem } from '../PhotoViewer';
import { getDocumentByPath } from '../../database';
import { getPinnedItems, resetPinnedCacheForTests } from '../../utils/PinnedItems';
import type { DocumentRecord } from '../../database';

jest.mock('../../database', () => ({ getDocumentByPath: jest.fn() }));

const lookup = getDocumentByPath as jest.Mock;
const setString = Clipboard.setString as jest.Mock;

const NOW = Date.now();
const ITEMS: ViewerItem[] = [
  { uri: 'content://media/1', takenAt: NOW - 60_000 },
  { uri: 'content://media/2', takenAt: NOW - 2 * 86_400_000 },
];

const record = (overrides: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 1,
  title: 'Electricity bill',
  content: 'Electricity bill amount due 1240',
  filePath: 'content://media/1',
  type: 'IMAGE',
  detection_type: 'TEXT',
  timestamp: NOW,
  ...overrides,
});

const show = (props: Partial<React.ComponentProps<typeof PhotoViewer>> = {}) =>
  render(<PhotoViewer items={ITEMS} index={0} onClose={jest.fn()} {...props} />);

const realOS = Platform.OS;

beforeEach(() => {
  lookup.mockReset();
  lookup.mockReturnValue(null);
  setString.mockClear();
  resetPinnedCacheForTests();
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (Platform as unknown as { OS: string }).OS = realOS;
  jest.restoreAllMocks();
});

describe('PhotoViewer', () => {
  it('stays closed while index is null', async () => {
    await render(<PhotoViewer items={ITEMS} index={null} onClose={jest.fn()} />);
    expect(screen.queryByTestId('photo-viewer-panel')).toBeNull();
  });

  it('shows the date and position, and closes', async () => {
    const onClose = jest.fn();
    await show({ onClose });
    expect(screen.getByRole('header', { name: 'Photo' })).toBeTruthy();
    expect(screen.getByText('1 min ago')).toBeTruthy();
    expect(screen.getByTestId('photo-viewer-position')).toHaveTextContent('1 of 2');
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the words Pinpointer read, and copies them', async () => {
    lookup.mockReturnValue(record());
    await show();
    expect(lookup).toHaveBeenCalledWith('content://media/1');
    expect(screen.getByText('Electricity bill amount due 1240')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Copy text' }));
    expect(setString).toHaveBeenCalledWith('Electricity bill amount due 1240');
    // Copy replaces "Read text" when there is text.
    expect(screen.queryByRole('button', { name: 'Read text' })).toBeNull();
  });

  it('says ID numbers are hidden when the text was masked', async () => {
    lookup.mockReturnValue(record({ content: 'Aadhaar XXXX XXXX 4821' }));
    await show();
    expect(screen.getByText('ID numbers are hidden for safety')).toBeTruthy();
  });

  it('marks the searched words', async () => {
    lookup.mockReturnValue(record());
    await show({ highlightTerms: ['bill'] });
    expect(screen.getAllByTestId('highlight-match').length).toBeGreaterThan(0);
  });

  it('offers Read text for a photo not read yet', async () => {
    const onReadText = jest.fn();
    await show({ onReadText });
    expect(screen.getByTestId('photo-viewer-no-text')).toHaveTextContent(/has not read this photo yet/);
    await fireEvent.press(screen.getByRole('button', { name: 'Read text' }));
    expect(onReadText).toHaveBeenCalledWith('content://media/1');
  });

  it('says no words were found when the photo has none', async () => {
    lookup.mockReturnValue(record({ detection_type: 'OBJECT', content: 'Paper, Document' }));
    await show();
    expect(screen.getByText('No words found in this photo.')).toBeTruthy();
    expect(screen.queryByText('Paper, Document')).toBeNull();
  });

  it('stars the photo as Important and back', async () => {
    lookup.mockReturnValue(record());
    await show();
    const star = screen.getByRole('button', { name: 'Important' });
    expect(star.props.accessibilityState).toMatchObject({ selected: false });
    await act(async () => {
      await fireEvent.press(star);
    });
    await waitFor(async () => expect(await getPinnedItems()).toHaveLength(1));
    const [pinned] = await getPinnedItems();
    expect(pinned).toMatchObject({ uri: 'content://media/1', kind: 'IMAGE', title: 'Electricity bill' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Important' }).props.accessibilityState).toMatchObject({ selected: true }),
    );
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Important' }));
    });
    await waitFor(async () => expect(await getPinnedItems()).toHaveLength(0));
  });

  it('shares through the native module on Android', async () => {
    (Platform as unknown as { OS: string }).OS = 'android';
    const shareImage = NativeModules.StorageModule.shareImage as jest.Mock;
    shareImage.mockClear();
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(shareImage).toHaveBeenCalledWith('content://media/1');
  });

  it('shares with Share.share elsewhere', async () => {
    (Platform as unknown as { OS: string }).OS = 'ios';
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(spy).toHaveBeenCalledWith({ url: 'content://media/1' });
  });

  it('opens the photo in the gallery app', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Gallery' }));
    expect(open).toHaveBeenCalledWith('content://media/1');
  });

  it('uses the words it was given instead of reading the index', async () => {
    await render(
      <PhotoViewer items={[{ uri: 'content://media/9', text: 'bijli bill 1240' }]} index={0} onClose={jest.fn()} />,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(screen.getByText('bijli bill 1240')).toBeTruthy();
    // One photo: no "1 of 1".
    expect(screen.queryByText(/of 1/)).toBeNull();
  });

  it('given empty words, says none were found', async () => {
    await render(<PhotoViewer items={[{ uri: 'content://media/9', text: '' }]} index={0} onClose={jest.fn()} />);
    expect(screen.getByText('No words found in this photo.')).toBeTruthy();
  });

  it('says how many words were found', async () => {
    await render(<PhotoViewer items={[{ uri: 'content://media/9', text: 'Amount due 1240' }]} index={0} onClose={jest.fn()} />);
    expect(screen.getByTestId('photo-viewer-words')).toHaveTextContent('3 words');
  });

  it('opens at the photo it was given', async () => {
    await render(<PhotoViewer items={ITEMS} index={1} onClose={jest.fn()} />);
    expect(screen.getByText('2 days ago')).toBeTruthy();
    expect(screen.getByTestId('photo-viewer-position')).toHaveTextContent('2 of 2');
    expect(lookup).toHaveBeenCalledWith('content://media/2');
  });
});
