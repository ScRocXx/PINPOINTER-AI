import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ReadyView, ReadyViewProps } from '../ReadyView';
import { LanguageProvider, en, hi } from '../../../i18n';

const base: ReadyViewProps = {
  dots: { index: 3, count: 4, from: 2 },
  photos: { allowed: true, done: 120, total: 2400, busy: true, finished: false },
  papers: { allowed: true, done: 0, total: null, running: false, waiting: true },
  onAllowPhotos: jest.fn(),
  onAllowPapers: jest.fn(),
  onFinish: jest.fn(),
};

const renderReady = (over: Partial<ReadyViewProps> = {}, lang: 'en' | 'hi' = 'en') =>
  render(
    <LanguageProvider initialLanguage={lang}>
      <ReadyView {...base} {...over} />
    </LanguageProvider>,
  );

beforeEach(() => jest.clearAllMocks());

describe('ReadyView', () => {
  it('shows the count on the ring while photos get ready', async () => {
    await renderReady();
    expect(screen.getByText(en['progress.photosTitle'])).toBeTruthy();
    expect(screen.getByTestId('first-run-count')).toHaveTextContent('120');
    expect(screen.getByText(en['onboarding.rowPapersWaiting'])).toBeTruthy();
    expect(screen.queryByTestId('first-run-ring-done')).toBeNull();
  });

  it('says it is still counting before the total is known', async () => {
    await renderReady({ photos: { ...base.photos, done: 0, total: null } });
    expect(screen.getAllByText(en['onboarding.counting']).length).toBeGreaterThan(0);
    expect(screen.getByText(en['onboarding.rowReadingStart'])).toBeTruthy();
  });

  it('locks on with a tick when every photo is ready', async () => {
    await renderReady({
      photos: { allowed: true, done: 2400, total: 2400, busy: false, finished: true },
      papers: { allowed: true, done: 7, total: null, running: false, waiting: false },
    });
    expect(screen.getByTestId('first-run-ring-done')).toBeTruthy();
    expect(screen.getByText('All 2,400 photos ready')).toBeTruthy();
    expect(screen.getByText(en['onboarding.doneBody'])).toBeTruthy();
    expect(screen.getByText('All 2,400 ready')).toBeTruthy();
    expect(screen.getByText('7 papers ready')).toBeTruthy();
  });

  it('reads PDFs with their own count once photos are done', async () => {
    await renderReady({
      photos: { allowed: true, done: 10, total: 10, busy: false, finished: true },
      papers: { allowed: true, done: 3, total: 9, running: true, waiting: false },
    });
    expect(screen.getByText(en['onboarding.rowPapersReading'].replace('{done}', '3').replace('{total}', '9'))).toBeTruthy();
  });

  it('says so kindly when the phone has no photos', async () => {
    await renderReady({ photos: { allowed: true, done: 0, total: 0, busy: false, finished: false } });
    expect(screen.getByText(en['onboarding.noPhotosTitle'])).toBeTruthy();
    expect(screen.queryByTestId('first-run-ring')).toBeNull();
    expect(screen.getByTestId('first-run-mark')).toBeTruthy();
  });

  it('offers Allow on each row that is still off', async () => {
    await renderReady({
      photos: { allowed: false, done: 0, total: null, busy: false, finished: false },
      papers: { allowed: false, done: 0, total: null, running: false, waiting: false },
    });
    expect(screen.getByText(en['onboarding.readyTitleOff'])).toBeTruthy();
    expect(screen.getAllByText(en['onboarding.rowOff'])).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('first-run-row-allow-photos'));
    await fireEvent.press(screen.getByTestId('first-run-row-allow-papers'));
    expect(base.onAllowPhotos).toHaveBeenCalledTimes(1);
    expect(base.onAllowPapers).toHaveBeenCalledTimes(1);
  });

  it('shows the banner it is given and finishes from the main button', async () => {
    const { Text } = require('react-native');
    await renderReady({ banner: <Text>some photos banner</Text> });
    expect(screen.getByText('some photos banner')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('first-run-finish'));
    expect(base.onFinish).toHaveBeenCalledTimes(1);
  });

  it('speaks Hindi', async () => {
    await renderReady({}, 'hi');
    expect(screen.getByText(hi['progress.photosTitle'])).toBeTruthy();
  });
});
