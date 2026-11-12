/**
 * SmartClipboardScreen ("Read text from a photo", the Scan button).
 *
 * - '../../utils/VisionPipeline' is mocked: each test says what the photo
 *   holds (words, only objects, nothing, or a failure).
 * - 'react-native-image-picker' and '@react-native-clipboard/clipboard' come
 *   from the repo's root __mocks__.
 * - '@react-navigation/native' is mocked (useRoute / useNavigation).
 * - Toasts fall back to TalkBack announcements without a provider, so they
 *   are checked through AccessibilityInfo.
 */
import React from 'react';
import { AccessibilityInfo, Share, Vibration } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AUTO_SCAN_DELAY_MS, SmartClipboardScreen, countWords, resetScanClipsForTests } from '../SmartClipboardScreen';
import { analyzeImage, type VisionResult } from '../../utils/VisionPipeline';
import { translate } from '../../i18n/strings';

jest.mock('../../utils/VisionPipeline', () => ({ analyzeImage: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useRoute: jest.fn(), useNavigation: jest.fn() }));

type Vars = Record<string, string | number>;
const t = (key: Parameters<typeof translate>[1], vars?: Vars) => translate('en', key, vars);

const analyze = analyzeImage as jest.Mock;
const camera = launchCamera as jest.Mock;
const gallery = launchImageLibrary as jest.Mock;
const setString = Clipboard.setString as jest.Mock;

const nav = { goBack: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let params: { scanUri?: string } | undefined;
let announce: jest.SpyInstance;
let vibrate: jest.SpyInstance;
let share: jest.SpyInstance;

const PHOTO = 'file:///cache/photo.jpg';
const BILL = 'Electricity bill\nAmount due 1240';

const vision = (over: Partial<VisionResult> = {}): VisionResult => ({
  detection_type: 'TEXT',
  raw_text: BILL,
  content: '',
  search_index: [],
  optimized_status: '',
  embedding: null,
  ...over,
});

/** Take a photo with the camera and wait until reading has finished. */
const scan = async (result: VisionResult | Error = vision()) => {
  camera.mockResolvedValueOnce({ assets: [{ uri: PHOTO }] });
  if (result instanceof Error) {
    analyze.mockRejectedValueOnce(result);
  } else {
    analyze.mockResolvedValueOnce(result);
  }
  await fireEvent.press(screen.getByTestId('scan-camera'));
  await waitFor(() => expect(screen.queryByTestId('scan-reading')).toBeNull());
};

beforeEach(() => {
  jest.clearAllMocks();
  params = undefined;
  (useRoute as jest.Mock).mockImplementation(() => ({ key: 'scan', name: 'SmartClipboard', params }));
  (useNavigation as jest.Mock).mockReturnValue(nav);
  camera.mockResolvedValue({ assets: [] });
  gallery.mockResolvedValue({ assets: [] });
  resetScanClipsForTests();
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SmartClipboardScreen', () => {
  it('starts with a plain explanation and two ways to get a photo', async () => {
    await render(<SmartClipboardScreen />);
    expect(screen.getByRole('header', { name: t('scan.title') })).toBeTruthy();
    expect(screen.getByText(t('scan.intro'))).toBeTruthy();
    expect(screen.getByText(t('scan.languages'))).toBeTruthy();
    expect(screen.getByText(t('scan.takePhoto'))).toBeTruthy();
    expect(screen.getByText(t('scan.pickPhoto'))).toBeTruthy();
    expect(screen.queryByTestId('scan-clips')).toBeNull();
  });

  it('reads the words from a camera photo and lets the person fix them', async () => {
    await render(<SmartClipboardScreen />);
    await scan();
    expect(camera).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'photo', saveToPhotos: false }));
    expect(analyze).toHaveBeenCalledWith(PHOTO);
    expect(screen.getByRole('header', { name: t('scan.textFound') })).toBeTruthy();
    expect(screen.getByTestId('scan-text').props.value).toBe(BILL);
    expect(screen.getByText(t('scan.words', { n: 5 }))).toBeTruthy();
    expect(screen.getByTestId('scan-photo-image').props.source).toEqual({ uri: PHOTO });
    expect(vibrate).toHaveBeenCalledWith(30);

    await fireEvent.changeText(screen.getByTestId('scan-text'), 'Amount due');
    expect(screen.getByText(t('scan.words', { n: 2 }))).toBeTruthy();
  });

  it('reads a photo picked from the gallery', async () => {
    gallery.mockResolvedValueOnce({ assets: [{ uri: 'content://media/9' }] });
    analyze.mockResolvedValueOnce(vision({ raw_text: 'Hello' }));
    await render(<SmartClipboardScreen />);
    await fireEvent.press(screen.getByTestId('scan-gallery'));
    await waitFor(() => expect(screen.getByTestId('scan-text').props.value).toBe('Hello'));
    expect(screen.getByText(t('scan.oneWord'))).toBeTruthy();
  });

  it('shows "Reading the text…" with searching corners while it reads', async () => {
    let finish: (v: VisionResult) => void = () => {};
    camera.mockResolvedValueOnce({ assets: [{ uri: PHOTO }] });
    analyze.mockImplementationOnce(() => new Promise<VisionResult>(r => (finish = r)));
    await render(<SmartClipboardScreen />);
    await fireEvent.press(screen.getByTestId('scan-camera'));
    await waitFor(() => expect(screen.getByText(t('scan.reading'))).toBeTruthy());
    expect(screen.getByTestId('scan-lock')).toBeTruthy();
    await act(async () => finish(vision()));
    await waitFor(() => expect(screen.getByTestId('scan-text-card')).toBeTruthy());
  });

  it('copies the (fixed) text, confirms it and remembers it', async () => {
    await render(<SmartClipboardScreen />);
    await scan();
    await fireEvent.changeText(screen.getByTestId('scan-text'), '  Amount due 1240  ');
    await fireEvent.press(screen.getByTestId('scan-copy'));
    expect(setString).toHaveBeenCalledWith('Amount due 1240');
    expect(announce).toHaveBeenCalledWith(t('common.copied'));

    await fireEvent.press(screen.getByTestId('scan-another'));
    expect(screen.getByText(t('scan.copiedBefore'))).toBeTruthy();
    const row = screen.getByTestId('scan-clip-0');
    expect(row.props.accessibilityLabel).toBe(t('scan.copyAgain', { text: 'Amount due 1240' }));
    setString.mockClear();
    await fireEvent.press(row);
    expect(setString).toHaveBeenCalledWith('Amount due 1240');
  });

  it('keeps earlier copies when the screen is opened again', async () => {
    const first = await render(<SmartClipboardScreen />);
    await scan();
    await fireEvent.press(screen.getByTestId('scan-copy'));
    await first.unmount();
    await render(<SmartClipboardScreen />);
    expect(screen.getByTestId('scan-clip-0')).toBeTruthy();
  });

  it('shares the text', async () => {
    await render(<SmartClipboardScreen />);
    await scan();
    await fireEvent.press(screen.getByTestId('scan-share'));
    expect(share).toHaveBeenCalledWith({ message: BILL });
  });

  it('says "No words found" for a photo with no text, never success', async () => {
    await render(<SmartClipboardScreen />);
    await scan(vision({ detection_type: 'EMPTY', raw_text: '' }));
    expect(screen.getByRole('header', { name: t('scan.noTextTitle') })).toBeTruthy();
    expect(screen.getByText(t('scan.noTextBody'))).toBeTruthy();
    expect(screen.queryByTestId('scan-text-card')).toBeNull();
    expect(screen.queryByText(/success/i)).toBeNull();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('treats a photo of only objects ("dog, grass") as no words', async () => {
    await render(<SmartClipboardScreen />);
    await scan(vision({ detection_type: 'OBJECT', raw_text: 'Dog, Grass' }));
    expect(screen.getByTestId('scan-no-text')).toBeTruthy();
    expect(screen.queryByText('Dog, Grass')).toBeNull();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('offers a new photo or another one after no words were found', async () => {
    await render(<SmartClipboardScreen />);
    await scan(vision({ detection_type: 'EMPTY', raw_text: '' }));
    camera.mockClear();
    await fireEvent.press(screen.getByTestId('scan-retry'));
    expect(camera).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('scan-pick-another'));
    expect(gallery).toHaveBeenCalled();
  });

  it('says plainly when the photo could not be read, and tries again', async () => {
    await render(<SmartClipboardScreen />);
    await scan(new Error('ocr failed'));
    expect(screen.getByRole('header', { name: t('scan.errorTitle') })).toBeTruthy();
    analyze.mockResolvedValueOnce(vision());
    await fireEvent.press(screen.getByTestId('scan-retry'));
    await waitFor(() => expect(screen.getByTestId('scan-text-card')).toBeTruthy());
    expect(analyze).toHaveBeenLastCalledWith(PHOTO);
  });

  it('does nothing when the camera is cancelled', async () => {
    await render(<SmartClipboardScreen />);
    await fireEvent.press(screen.getByTestId('scan-camera'));
    expect(analyze).not.toHaveBeenCalled();
    expect(screen.getByTestId('scan-start')).toBeTruthy();
  });

  it('says so when the camera cannot open, instead of doing nothing', async () => {
    const said = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    camera.mockResolvedValueOnce({ errorCode: 'camera_unavailable' });
    await render(<SmartClipboardScreen />);
    await fireEvent.press(screen.getByTestId('scan-camera'));
    await waitFor(() => expect(said).toHaveBeenCalledWith('The camera could not open. You can pick a photo instead.'));
    expect(analyze).not.toHaveBeenCalled();
    expect(screen.getByTestId('scan-start')).toBeTruthy();
    said.mockRestore();
  });

  it('reads a photo it was opened with, once, after the screen slides in', async () => {
    params = { scanUri: 'content://media/42' };
    analyze.mockResolvedValue(vision({ raw_text: 'Ticket' }));
    await render(<SmartClipboardScreen />);
    expect(screen.getByTestId('scan-reading')).toBeTruthy();
    expect(nav.setParams).toHaveBeenCalledWith({ scanUri: undefined });
    // Reading waits for the screen to slide in.
    expect(analyze).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('scan-text').props.value).toBe('Ticket'), {
      timeout: AUTO_SCAN_DELAY_MS + 1500,
    });
    expect(analyze).toHaveBeenCalledWith('content://media/42');
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('opens the whole photo and closes it', async () => {
    await render(<SmartClipboardScreen />);
    await scan();
    await fireEvent.press(screen.getByTestId('scan-photo'));
    expect(screen.getByTestId('scan-photo-modal')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('scan-photo-close'));
    expect(screen.queryByTestId('scan-photo-modal')).toBeNull();
  });

  it('closes the screen', async () => {
    await render(<SmartClipboardScreen />);
    await fireEvent.press(screen.getByTestId('scan-close'));
    expect(nav.goBack).toHaveBeenCalled();
  });

  it('ignores a reading that finishes after leaving the screen', async () => {
    let finish: (v: VisionResult) => void = () => {};
    camera.mockResolvedValueOnce({ assets: [{ uri: PHOTO }] });
    analyze.mockImplementationOnce(() => new Promise<VisionResult>(r => (finish = r)));
    const view = await render(<SmartClipboardScreen />);
    await fireEvent.press(screen.getByTestId('scan-camera'));
    await view.unmount();
    await act(async () => finish(vision()));
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('countWords', () => {
  it('counts words across lines and spaces', () => {
    expect(countWords('  a  b\nc ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});
