/**
 * The first run, step by step: welcome (and the language switch), photo
 * access with every answer Android can give, PDF access (All files access
 * or a folder), and the first look through the gallery.
 *
 * The access hooks are replaced by small stateful fakes, so a test says what
 * Android answers and the screen reacts as it would on a phone. The queue
 * and its progress are mocked: this suite checks what the screen starts and
 * shows, not the indexing itself.
 */
import React from 'react';
import { BackHandler } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FirstRunScreen } from '../FirstRunScreen';
import { LanguageProvider, en, hi } from '../../i18n';
import type { DocumentAccess, PhotoAccess } from '../../utils/StoragePermissions';
import { IndexingService } from '../../services/IndexingService';
import { markFirstRunDone } from '../../utils/FirstRun';
import type { IndexingProgress } from '../../hooks/useIndexingProgress';

const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset }) }));

/** What the fakes start with and what Android answers next. */
const mockAndroid = {
  photoStart: 'denied' as PhotoAccess,
  photoAnswer: 'full' as PhotoAccess,
  settingsAnswer: 'full' as PhotoAccess,
  docStart: 'none' as DocumentAccess,
  allFilesAnswer: 'all' as DocumentAccess,
  folderPicked: true,
  pdfsPicked: 0,
  canAskAll: true,
  allFilesApplies: true,
  calls: { request: 0, openSettings: 0, allowAll: 0, chooseFolder: 0, pickFiles: 0 },
};

jest.mock('../../hooks/useStorageAccess', () => {
  const ReactActual = jest.requireActual('react');
  return {
    usePhotoAccess: () => {
      const [access, setAccess] = ReactActual.useState(mockAndroid.photoStart);
      const answer = async (next: PhotoAccess) => {
        setAccess(next);
        return next;
      };
      return {
        access,
        refresh: async () => access,
        request: () => {
          mockAndroid.calls.request++;
          return answer(mockAndroid.photoAnswer);
        },
        openSettings: () => {
          mockAndroid.calls.openSettings++;
          return answer(mockAndroid.settingsAnswer);
        },
      };
    },
    useDocumentAccess: () => {
      const [access, setAccess] = ReactActual.useState(mockAndroid.docStart);
      return {
        access,
        canAskAll: mockAndroid.canAskAll,
        refresh: async () => access,
        allowAll: async () => {
          mockAndroid.calls.allowAll++;
          setAccess(mockAndroid.allFilesAnswer);
          return mockAndroid.allFilesAnswer;
        },
        chooseFolder: async () => {
          mockAndroid.calls.chooseFolder++;
          if (mockAndroid.folderPicked) setAccess('folders');
          return mockAndroid.folderPicked;
        },
        pickFiles: async () => {
          mockAndroid.calls.pickFiles++;
          return mockAndroid.pdfsPicked;
        },
      };
    },
  };
});

jest.mock('../../utils/StoragePermissions', () => ({
  allFilesAccessApplies: () => mockAndroid.allFilesApplies,
  photoSettingsWording: () => ({ list: 'photos', choice: 'allowAll' }),
  isLimitedAccessKept: jest.fn(async () => false),
  keepLimitedAccess: jest.fn(async () => {}),
}));

jest.mock('../../utils/FirstRun', () => ({ markFirstRunDone: jest.fn(async () => {}) }));

jest.mock('../../services/IndexingService', () => ({
  IndexingService: {
    deepGallerySync: jest.fn(() => new Promise(() => {})),
    documentSync: jest.fn(async () => ({ status: 'done', processed: 0, total: 0, wasCancelled: false })),
    backfill: jest.fn(async () => 0),
  },
}));

const mockProgress: IndexingProgress = {
  photos: { done: 0, total: null, running: false, queued: false },
  papers: { done: 0, total: null, running: false, queued: false },
};
jest.mock('../../hooks/useIndexingProgress', () => ({ useIndexingProgress: () => mockProgress }));

let backHandlers: Array<() => boolean | null | undefined>;

const renderFirstRun = async (lang: 'en' | 'hi' = 'en', onFinish?: () => void) => {
  await render(
    <LanguageProvider initialLanguage={lang}>
      <FirstRunScreen onFinish={onFinish} />
    </LanguageProvider>,
  );
  await act(async () => {});
};

const tap = async (testID: string) => {
  await fireEvent.press(screen.getByTestId(testID));
  await act(async () => {});
};

const pressBack = async () => {
  let handled = false;
  await act(async () => {
    handled = [...backHandlers].reverse().some(h => !!h());
  });
  return handled;
};

const stepLabel = () => screen.getByTestId('step-dots').props.accessibilityLabel as string;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockAndroid, {
    photoStart: 'denied',
    photoAnswer: 'full',
    settingsAnswer: 'full',
    docStart: 'none',
    allFilesAnswer: 'all',
    folderPicked: true,
    pdfsPicked: 0,
    canAskAll: true,
    allFilesApplies: true,
    calls: { request: 0, openSettings: 0, allowAll: 0, chooseFolder: 0, pickFiles: 0 },
  });
  mockProgress.photos = { done: 0, total: null, running: false, queued: false };
  mockProgress.papers = { done: 0, total: null, running: false, queued: false };
  backHandlers = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, fn: () => boolean) => {
    backHandlers.push(fn);
    return {
      remove: () => {
        backHandlers = backHandlers.filter(h => h !== fn);
      },
    };
  }) as unknown as typeof BackHandler.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('welcome', () => {
  it('says what Pinpointer does and that nothing leaves the phone', async () => {
    await renderFirstRun();
    expect(screen.getByRole('header', { name: en['onboarding.welcomeTitle'] })).toBeTruthy();
    expect(screen.getByText(en['onboarding.private'])).toBeTruthy();
    expect(stepLabel()).toBe('Step 1 of 4');
  });

  it('switches to Hindi before anything else is read', async () => {
    await renderFirstRun();
    await fireEvent.press(screen.getByRole('radio', { name: 'Hindi, हिन्दी' }));
    expect(screen.getByRole('header', { name: hi['onboarding.welcomeTitle'] })).toBeTruthy();
    expect(screen.getByText(hi['onboarding.start'])).toBeTruthy();
  });

  it('leaves the app on Android back, like any first screen', async () => {
    await renderFirstRun();
    expect(await pressBack()).toBe(false);
  });
});

describe('photos', () => {
  const toPhotos = async () => {
    await renderFirstRun();
    await tap('first-run-start');
    expect(screen.getByRole('header', { name: en['onboarding.photosTitle'] })).toBeTruthy();
  };

  it('explains before Android asks, then moves on once photos are allowed', async () => {
    await toPhotos();
    expect(screen.getByText(en['onboarding.photosPoint2'])).toBeTruthy();
    expect(stepLabel()).toBe('Step 2 of 4');
    await tap('first-run-allow-photos');
    expect(mockAndroid.calls.request).toBe(1);
    expect(screen.getByRole('header', { name: en['onboarding.filesTitle'] })).toBeTruthy();
    expect(stepLabel()).toBe('Step 3 of 4');
  });

  it('takes "Select photos" as a yes', async () => {
    mockAndroid.photoAnswer = 'limited';
    await toPhotos();
    await tap('first-run-allow-photos');
    expect(screen.getByTestId('first-run-files')).toBeTruthy();
  });

  it('explains gently after a no, and lets them ask again', async () => {
    mockAndroid.photoAnswer = 'denied';
    await toPhotos();
    await tap('first-run-allow-photos');
    expect(screen.getByText(en['onboarding.photosDeniedTitle'])).toBeTruthy();
    expect(screen.getByTestId('first-run-photos')).toBeTruthy();

    mockAndroid.photoAnswer = 'full';
    await tap('first-run-allow-photos');
    expect(mockAndroid.calls.request).toBe(2);
    expect(screen.getByTestId('first-run-files')).toBeTruthy();
  });

  it('when Android won’t ask again, writes out the Settings steps and opens Settings', async () => {
    mockAndroid.photoAnswer = 'blocked';
    await toPhotos();
    expect(screen.getByTestId('photos-art', { includeHiddenElements: true })).toBeTruthy();
    await tap('first-run-allow-photos');
    expect(screen.getByText(en['onboarding.photosBlockedTitle'])).toBeTruthy();
    expect(screen.getByText(en['onboarding.photosStep3'])).toBeTruthy();
    // The picture makes way, so all the steps fit on a small phone.
    expect(screen.queryByTestId('photos-art', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText(en['perm.openSettings'])).toBeTruthy();

    // Back from Settings without turning it on: still the Settings steps.
    mockAndroid.settingsAnswer = 'denied';
    await tap('first-run-allow-photos');
    expect(mockAndroid.calls.openSettings).toBe(1);
    expect(screen.getByText(en['onboarding.photosBlockedTitle'])).toBeTruthy();

    mockAndroid.settingsAnswer = 'full';
    await tap('first-run-allow-photos');
    expect(mockAndroid.calls.openSettings).toBe(2);
    expect(screen.getByTestId('first-run-files')).toBeTruthy();
  });

  it('never traps anyone: Not now moves on without asking', async () => {
    await toPhotos();
    await tap('first-run-skip-photos');
    expect(mockAndroid.calls.request).toBe(0);
    expect(screen.getByTestId('first-run-files')).toBeTruthy();
  });

  it('goes back to the welcome with the arrow and with Android back', async () => {
    await toPhotos();
    await tap('first-run-back');
    expect(screen.getByTestId('first-run-welcome')).toBeTruthy();
    await tap('first-run-start');
    expect(await pressBack()).toBe(true);
    expect(screen.getByTestId('first-run-welcome')).toBeTruthy();
  });
});

describe('PDFs', () => {
  const toFiles = async () => {
    mockAndroid.photoStart = 'full'; // photos step drops out
    await renderFirstRun();
    expect(stepLabel()).toBe('Step 1 of 3');
    await tap('first-run-start');
    expect(screen.getByRole('header', { name: en['onboarding.filesTitle'] })).toBeTruthy();
  };

  it('says what the Settings switch looks like, then opens it', async () => {
    await toFiles();
    expect(screen.getByText(en['onboarding.filesGuide1'])).toBeTruthy();
    expect(screen.getByText(en['onboarding.filesGuide2'])).toBeTruthy();
    await tap('first-run-allow-files');
    expect(mockAndroid.calls.allowAll).toBe(1);
    expect(screen.getByTestId('first-run-ready')).toBeTruthy();
  });

  it('stays and says so when the switch is still off', async () => {
    mockAndroid.allFilesAnswer = 'none';
    await toFiles();
    await tap('first-run-allow-files');
    expect(screen.getByText(en['onboarding.filesStillOff'])).toBeTruthy();
    expect(screen.getByTestId('first-run-files')).toBeTruthy();
    expect(screen.queryByTestId('papers-art', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText(en['onboarding.filesGuide1'])).toBeTruthy();
  });

  it('accepts one folder instead', async () => {
    await toFiles();
    await tap('first-run-choose-folder');
    expect(mockAndroid.calls.chooseFolder).toBe(1);
    expect(screen.getByTestId('first-run-ready')).toBeTruthy();
  });

  it('stays when the folder picker is closed without a folder', async () => {
    mockAndroid.folderPicked = false;
    await toFiles();
    await tap('first-run-choose-folder');
    expect(screen.getByTestId('first-run-files')).toBeTruthy();
    expect(screen.queryByText(en['onboarding.filesStillOff'])).toBeNull();
  });

  it('offers a folder or single PDFs when this build can’t ask for all files', async () => {
    mockAndroid.canAskAll = false;
    mockAndroid.pdfsPicked = 2;
    await toFiles();
    expect(screen.queryByTestId('first-run-allow-files')).toBeNull();
    expect(screen.getByText(en['onboarding.filesFolderBody'])).toBeTruthy();
    await tap('first-run-pick-pdfs');
    expect(mockAndroid.calls.pickFiles).toBe(1);
    expect(screen.getByTestId('first-run-ready')).toBeTruthy();
    // The picked PDFs are read now, though no folder was allowed.
    expect(IndexingService.documentSync).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('first-run-row-allow-papers')).toBeNull();
  });

  it('has no step of its own below Android 11 (the photo permission covers files)', async () => {
    mockAndroid.allFilesApplies = false;
    await renderFirstRun();
    expect(stepLabel()).toBe('Step 1 of 3');
    await tap('first-run-start');
    await tap('first-run-allow-photos');
    expect(screen.getByTestId('first-run-ready')).toBeTruthy();
  });

  it('drops out when All files access is already on', async () => {
    mockAndroid.photoStart = 'full';
    mockAndroid.docStart = 'all';
    await renderFirstRun();
    expect(stepLabel()).toBe('Step 1 of 2');
    await tap('first-run-start');
    expect(screen.getByTestId('first-run-ready')).toBeTruthy();
  });
});

describe('getting ready', () => {
  const toReady = async (onFinish?: () => void) => {
    mockAndroid.photoStart = 'full';
    mockAndroid.docStart = 'all';
    await renderFirstRun('en', onFinish);
    await tap('first-run-start');
  };

  it('starts reading photos, then PDFs, once', async () => {
    await toReady();
    expect(IndexingService.deepGallerySync).toHaveBeenCalledTimes(1);
    expect(IndexingService.documentSync).toHaveBeenCalledTimes(1);
  });

  it('shows the count in plain numbers', async () => {
    mockProgress.photos = { done: 120, total: 2400, running: true, queued: false };
    mockProgress.papers = { done: 0, total: null, running: false, queued: true };
    await toReady();
    expect(screen.getByRole('header', { name: en['progress.photosTitle'] })).toBeTruthy();
    expect(screen.getByTestId('first-run-count')).toHaveTextContent('120');
    expect(screen.getByText('of 2,400 photos')).toBeTruthy();
    expect(screen.getByText('Reading text · 120 of 2,400')).toBeTruthy();
    expect(screen.getByText(en['onboarding.rowPapersWaiting'])).toBeTruthy();
    expect(screen.getByLabelText('120 of 2,400 photos ready')).toBeTruthy();
  });

  it('starts nothing for photos that aren’t allowed, and offers them in the row', async () => {
    mockAndroid.photoAnswer = 'denied';
    await renderFirstRun();
    await tap('first-run-start');
    await tap('first-run-skip-photos');
    await tap('first-run-skip-files');
    expect(IndexingService.deepGallerySync).not.toHaveBeenCalled();
    expect(IndexingService.documentSync).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: en['onboarding.readyTitleOff'] })).toBeTruthy();

    mockAndroid.photoAnswer = 'full';
    await tap('first-run-row-allow-photos');
    expect(mockAndroid.calls.request).toBe(1);
    expect(IndexingService.deepGallerySync).toHaveBeenCalledTimes(1);

    await tap('first-run-row-allow-papers');
    expect(mockAndroid.calls.allowAll).toBe(1);
    expect(IndexingService.documentSync).toHaveBeenCalledTimes(1);
  });

  it('“Start searching” remembers the first run and opens Home', async () => {
    await toReady();
    await tap('first-run-finish');
    expect(markFirstRunDone).toHaveBeenCalledTimes(1);
    expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
  });

  it('Android back on the last step opens Home too, only once', async () => {
    const onFinish = jest.fn();
    await toReady(onFinish);
    expect(await pressBack()).toBe(true);
    expect(await pressBack()).toBe(true);
    expect(markFirstRunDone).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(mockReset).not.toHaveBeenCalled();
  });
});
