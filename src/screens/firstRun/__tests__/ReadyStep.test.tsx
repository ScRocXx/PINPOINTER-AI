import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { ReadyStep } from '../ReadyStep';
import { LanguageProvider, en } from '../../../i18n';
import { IndexingService } from '../../../services/IndexingService';
import type { DocumentAccessApi, PhotoAccessApi } from '../../../hooks/useStorageAccess';
import type { DocumentAccess, PhotoAccess } from '../../../utils/StoragePermissions';

jest.mock('react-native-svg', () => require('../../../components/ui/__tests__/svgMock').default);
jest.mock('../../../components/PhotoAccessBanner', () => ({ PhotoAccessBanner: () => null }));
jest.mock('../../../hooks/useIndexingProgress', () => ({
  useIndexingProgress: () => ({
    // Photos still being read, so only the step's own "finished" can say "all ready".
    photos: { done: 1, total: 5, running: true, queued: false, quick: false },
    papers: { done: 0, total: null, running: false, queued: false },
  }),
}));

type Resolve = (r: { processed: number; wasCancelled: boolean }) => void;
const mockGalleryRuns: Resolve[] = [];
jest.mock('../../../services/IndexingService', () => ({
  IndexingService: {
    deepGallerySync: jest.fn(() => new Promise(resolve => mockGalleryRuns.push(resolve))),
    documentSync: jest.fn(async () => ({ wasCancelled: false })),
    backfill: jest.fn(async () => ({ wasCancelled: false })),
  },
}));

const photos = (access: PhotoAccess | null): PhotoAccessApi => ({
  access,
  refresh: jest.fn(async () => access ?? 'denied'),
  request: jest.fn(async () => access ?? 'denied'),
  openSettings: jest.fn(async () => access ?? 'denied'),
});
const docs = (access: DocumentAccess | null): DocumentAccessApi => ({
  access,
  canAskAll: true,
  refresh: jest.fn(async () => access ?? 'none'),
  allowAll: jest.fn(async () => access ?? 'none'),
  chooseFolder: jest.fn(async () => false),
  pickFiles: jest.fn(async () => 0),
});

const ui = (p: PhotoAccess | null, d: DocumentAccess | null = 'none') => (
  <LanguageProvider initialLanguage="en">
    <ReadyStep dots={{ index: 3, count: 4 }} photos={photos(p)} docs={docs(d)} onFinish={jest.fn()} />
  </LanguageProvider>
);

const finishRun = async (i: number) => {
  await act(async () => mockGalleryRuns[i]({ processed: 5, wasCancelled: false }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGalleryRuns.length = 0;
});

describe('ReadyStep', () => {
  it('says all photos are ready once the first look ends, then starts the photo search pass', async () => {
    await render(ui('full'));
    expect(IndexingService.deepGallerySync).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('first-run-ring-done')).toBeNull();
    await finishRun(0);
    expect(screen.getByTestId('first-run-ring-done')).toBeTruthy();
    expect(IndexingService.backfill).toHaveBeenCalledTimes(1);
  });

  it('looks again when all photos are allowed after only some, and stops saying "all ready"', async () => {
    const view = await render(ui('limited'));
    await finishRun(0);
    expect(screen.getByTestId('first-run-ring-done')).toBeTruthy();

    await view.rerender(ui('full'));
    expect(IndexingService.deepGallerySync).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('first-run-ring-done')).toBeNull();
    expect(screen.getByText(en['progress.photosTitle'])).toBeTruthy();
  });

  it('runs one more pass when more photos are allowed while a pass is going', async () => {
    const view = await render(ui('limited'));
    await view.rerender(ui('full'));
    // The running pass is joined, not doubled.
    expect(IndexingService.deepGallerySync).toHaveBeenCalledTimes(1);
    await finishRun(0);
    expect(IndexingService.deepGallerySync).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('first-run-ring-done')).toBeNull();
    await finishRun(1);
    expect(screen.getByTestId('first-run-ring-done')).toBeTruthy();
    expect(IndexingService.backfill).toHaveBeenCalledTimes(1);
  });

  it('does not claim "all ready" when the pass was stopped', async () => {
    await render(ui('full'));
    await act(async () => mockGalleryRuns[0]({ processed: 2, wasCancelled: true }));
    expect(screen.queryByTestId('first-run-ring-done')).toBeNull();
    expect(IndexingService.backfill).not.toHaveBeenCalled();
  });

  it('starts nothing without access', async () => {
    await render(ui('denied', 'none'));
    expect(IndexingService.deepGallerySync).not.toHaveBeenCalled();
    expect(IndexingService.documentSync).not.toHaveBeenCalled();
  });
});
