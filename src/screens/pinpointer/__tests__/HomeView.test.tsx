/**
 * HomeView on its own: the presentational Home, in English and Hindi, with
 * sample data. The wiring (context, stars, opening files) is covered by
 * PinpointerScreen's tests.
 */
jest.mock('react-native-svg', () => require('../../../components/ui/__tests__/svgMock').default);

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { LanguageProvider } from '../../../i18n';
import type { Language } from '../../../i18n';
import { HomeView, HomeViewProps, PaperIndexing, PhotoIndexing, greetingKey, homeStatus } from '../HomeView';
import type { CollectionTileState } from '../../../hooks/useHomeOverview';
import type { CollectionId } from '../../../utils/Collections';

const idle: PhotoIndexing = {
  running: false,
  paused: false,
  quick: true,
  processed: 0,
  checked: null,
  total: null,
  lastChecked: null,
};
const noPapers: PaperIndexing = { running: false, done: 0, total: 0, lastChecked: null };

const tiles = (over: Partial<Record<CollectionId, CollectionTileState>> = {}): Record<CollectionId, CollectionTileState> => ({
  id: { count: null, capped: false, photos: [] },
  bill: { count: null, capped: false, photos: [] },
  medicine: { count: null, capped: false, photos: [] },
  bank: { count: null, capped: false, photos: [] },
  screenshot: { count: null, capped: false, photos: [] },
  family: { count: null, capped: false, photos: [] },
  ...over,
});

const props = (over: Partial<HomeViewProps> = {}): HomeViewProps => ({
  onOpenSearch: jest.fn(),
  onVoicePress: jest.fn(),
  listening: false,
  understanding: false,
  photos: idle,
  papers: noPapers,
  onCheck: jest.fn(),
  onPause: jest.fn(),
  onResume: jest.fn(),
  collections: tiles(),
  onOpenCollection: jest.fn(),
  pinned: [],
  onOpenPinned: jest.fn(),
  recent: [],
  onOpenPhoto: jest.fn(),
  now: new Date(2026, 10, 10, 9, 0),
  ...over,
});

const renderHome = (p: HomeViewProps, lang: Language = 'en') =>
  render(
    <LanguageProvider initialLanguage={lang}>
      <HomeView {...p} />
    </LanguageProvider>,
  );

describe('greetingKey', () => {
  test.each([
    [5, 'home.greetingMorning'],
    [11, 'home.greetingMorning'],
    [12, 'home.greetingAfternoon'],
    [16, 'home.greetingAfternoon'],
    [17, 'home.greetingEvening'],
    [23, 'home.greetingEvening'],
    [2, 'home.greetingEvening'],
  ])('%i:00 → %s', (hour, key) => {
    expect(greetingKey(hour)).toBe(key);
  });
});

describe('homeStatus', () => {
  test('a quick check fills against the newest 50 photos', () => {
    expect(homeStatus({ ...idle, running: true, quick: true, processed: 25 }, noPapers)).toEqual({
      kind: 'photosRunning',
      value: 0.5,
    });
  });

  test('a full check fills against every photo on the phone', () => {
    expect(
      homeStatus({ ...idle, running: true, quick: false, checked: 600, total: 2400 }, noPapers),
    ).toEqual({ kind: 'photosRunning', value: 0.25 });
  });

  test('a full check without a known total is "still counting"', () => {
    expect(homeStatus({ ...idle, running: true, quick: false }, noPapers)).toEqual({
      kind: 'photosRunning',
      value: undefined,
    });
  });

  test('paused beats papers; papers beat "left"', () => {
    expect(homeStatus({ ...idle, paused: true }, { ...noPapers, running: true }).kind).toBe('photosPaused');
    expect(homeStatus({ ...idle, checked: 1, total: 9 }, { ...noPapers, running: true, done: 1, total: 4 })).toEqual({
      kind: 'papersRunning',
      value: 0.25,
    });
  });

  test('photos still to check, then all checked', () => {
    expect(homeStatus({ ...idle, checked: 90, total: 100 }, noPapers)).toEqual({ kind: 'photosLeft', left: 10, value: 0.9 });
    expect(homeStatus({ ...idle, checked: 100, total: 100 }, noPapers)).toEqual({ kind: 'checked' });
    // Deleted photos can leave more checked than exist: still done.
    expect(homeStatus({ ...idle, checked: 120, total: 100 }, noPapers)).toEqual({ kind: 'checked' });
  });
});

describe('HomeView', () => {
  test('greets by the time of day and asks the question', async () => {
    await renderHome(props({ now: new Date(2026, 10, 10, 19, 0) }));
    expect(screen.getByText('Good evening')).toBeTruthy();
    expect(screen.getByText('What are you looking for?')).toBeTruthy();
    expect(screen.getByLabelText('Works without internet. Nothing leaves your phone.')).toBeTruthy();
  });

  test('the search bar opens search and the mic starts voice search', async () => {
    const p = props();
    await renderHome(p);
    await fireEvent.press(screen.getByTestId('home-search-open'));
    expect(p.onOpenSearch).toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Search by voice'));
    expect(p.onVoicePress).toHaveBeenCalled();
  });

  test('six Find quickly tiles, in two columns', async () => {
    await renderHome(props());
    const grid = screen.getByTestId('find-quickly');
    for (const label of ['ID cards', 'Bills', 'Medicine', 'Bank', 'Screenshots', 'Family']) {
      expect(within(grid).getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Aadhaar, PAN, voter ID')).toBeTruthy();
  });

  test('a tile shows the person’s own photos, the count, and locks on', async () => {
    await renderHome(
      props({ collections: tiles({ bill: { count: 34, capped: false, photos: ['content://1', 'content://2', 'content://3'] } }) }),
    );
    expect(screen.getAllByTestId('collection-bill-photo')).toHaveLength(3);
    expect(within(screen.getByTestId('collection-bill-count')).getByText('34')).toBeTruthy();
    expect(within(screen.getByTestId('collection-bill')).getAllByTestId('lock-on-corners')).toHaveLength(1);
    expect(screen.getByLabelText('Bills, 34 found, Bijli bills, receipts')).toBeTruthy();
  });

  test('a capped count reads "999+", an empty collection says "None yet"', async () => {
    await renderHome(
      props({
        collections: tiles({
          screenshot: { count: 999, capped: true, photos: [] },
          bank: { count: 0, capped: false, photos: [] },
        }),
      }),
    );
    expect(within(screen.getByTestId('collection-screenshot-count')).getByText('999+')).toBeTruthy();
    expect(screen.getByLabelText('Screenshots, 999+ found, From your phone screen')).toBeTruthy();
    expect(within(screen.getByTestId('collection-bank')).getByText('None yet')).toBeTruthy();
    expect(screen.queryByTestId('collection-bank-count')).toBeNull();
  });

  test('tapping a tile asks for that collection', async () => {
    const p = props();
    await renderHome(p);
    await fireEvent.press(screen.getByTestId('collection-family'));
    expect(p.onOpenCollection).toHaveBeenCalledWith('family');
  });

  test('Important: empty, then starred photos and papers', async () => {
    const p = props();
    const view = await renderHome(p);
    expect(screen.getByTestId('important-empty')).toBeTruthy();
    // English Home also shows the Hindi word.
    expect(screen.getByText('ज़रूरी')).toBeTruthy();

    const pinned = [
      { uri: 'content://pan', kind: 'IMAGE' as const, title: 'PAN card', pinnedAt: 2 },
      { uri: '/docs/gas.pdf', kind: 'DOCUMENT' as const, pinnedAt: 1 },
    ];
    await view.rerender(
      <LanguageProvider initialLanguage="en">
        <HomeView {...p} pinned={pinned} />
      </LanguageProvider>,
    );
    expect(screen.getAllByTestId('important-item')).toHaveLength(2);
    await fireEvent.press(screen.getByLabelText('Paper, Starred'));
    expect(p.onOpenPinned).toHaveBeenCalledWith(pinned[1]);
  });

  test('recently opened shows only when there are photos', async () => {
    const p = props();
    const view = await renderHome(p);
    expect(screen.queryByTestId('recent-row')).toBeNull();
    await view.rerender(
      <LanguageProvider initialLanguage="en">
        <HomeView {...p} recent={['content://9']} />
      </LanguageProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Photo, 1 of 1'));
    expect(p.onOpenPhoto).toHaveBeenCalledWith('content://9');
  });

  test('while listening, the bar says so and the beam ring is on', async () => {
    await renderHome(props({ listening: true }));
    expect(screen.getByLabelText('Listening… tap to stop')).toBeTruthy();
    expect(screen.getByLabelText('Stop listening')).toBeTruthy();
  });

  test('reads in Hindi', async () => {
    await renderHome(props(), 'hi');
    expect(screen.getByText('आप क्या ढूँढ रहे हैं?')).toBeTruthy();
    expect(screen.getByText('सुप्रभात')).toBeTruthy();
    expect(screen.getByText('पहचान पत्र')).toBeTruthy();
    expect(screen.getByText('आधार, पैन, वोटर कार्ड')).toBeTruthy();
    expect(screen.getByText('जल्दी ढूँढें')).toBeTruthy();
    // The Important heading is already Hindi: no second Hindi word.
    expect(screen.getAllByText('ज़रूरी')).toHaveLength(1);
    expect(screen.getByText('नई फ़ोटो अभी तक नहीं जाँची गईं')).toBeTruthy();
  });

  test('the indexing card replaces the checked line while work runs', async () => {
    const p = props({ photos: { ...idle, running: true, quick: false, processed: 40, checked: 1240, total: 2400 } });
    await renderHome(p);
    expect(screen.getByTestId('home-progress')).toBeTruthy();
    expect(screen.queryByTestId('home-checked')).toBeNull();
    expect(screen.getByText('1,240 of 2,400 · you can search now')).toBeTruthy();
    await fireEvent.press(screen.getByText('Pause'));
    expect(p.onPause).toHaveBeenCalled();
  });

  test('a running check without a total says how many are ready so far', async () => {
    await renderHome(props({ photos: { ...idle, running: true, quick: true, processed: 12 } }));
    expect(screen.getByText('12 ready · you can search now')).toBeTruthy();
  });
});
