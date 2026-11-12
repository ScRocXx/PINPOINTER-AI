import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ModelDownloadSheet, ModelSheetView } from '../ModelDownloadSheet';
import { LanguageProvider, en, hi } from '../../i18n';
import { areClipModelsAvailable } from '../../services/EmbeddingService';

// `voice` is what the screens read; the two flags describe the model behind it.
const mockModels = {
  isSTTLoaded: false,
  isSTTLoading: false,
  downloadAndLoadSTT: jest.fn(async () => {}),
  get voice(): 'ready' | 'loading' | 'off' {
    return this.isSTTLoaded ? 'ready' : this.isSTTLoading ? 'loading' : 'off';
  },
};
jest.mock('../../services/ModelService', () => ({ useModelService: () => mockModels }));
jest.mock('../../services/EmbeddingService', () => ({ areClipModelsAvailable: jest.fn(async () => true) }));

const clipAvailable = areClipModelsAvailable as jest.Mock;

const inEnglish = (node: React.ReactElement) => <LanguageProvider initialLanguage="en">{node}</LanguageProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.isSTTLoaded = false;
  mockModels.isSTTLoading = false;
  clipAvailable.mockResolvedValue(true);
});

describe('ModelSheetView', () => {
  it('says each helper is ready in plain words, and Done closes it', async () => {
    const onClose = jest.fn();
    await render(inEnglish(<ModelSheetView visible voice="ready" photo="ready" onPrepare={jest.fn()} onClose={onClose} />));
    expect(screen.getByText(en['models.voice'])).toBeTruthy();
    expect(screen.getByText(en['models.photo'])).toBeTruthy();
    expect(screen.getByTestId('model-voice-status')).toHaveTextContent(en['models.ready']);
    expect(screen.getByTestId('model-photo-status')).toHaveTextContent(en['models.ready']);
    expect(screen.queryByTestId('model-prepare')).toBeNull();
    await fireEvent.press(screen.getByTestId('model-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers the one fix when voice search failed to load', async () => {
    const onPrepare = jest.fn();
    await render(inEnglish(<ModelSheetView visible voice="off" photo="missing" onPrepare={onPrepare} onClose={jest.fn()} />));
    expect(screen.getByTestId('model-voice-status')).toHaveTextContent(en['models.notWorking']);
    expect(screen.getByTestId('model-photo-status')).toHaveTextContent(en['models.notInApp']);
    await fireEvent.press(screen.getByTestId('model-prepare'));
    expect(onPrepare).toHaveBeenCalledTimes(1);
  });

  it('shows a bar while voice search loads', async () => {
    await render(inEnglish(<ModelSheetView visible voice="loading" photo="checking" onPrepare={jest.fn()} onClose={jest.fn()} />));
    expect(screen.getByTestId('model-voice-bar')).toBeTruthy();
    expect(screen.getByTestId('model-photo-status')).toHaveTextContent(en['models.checking']);
  });

  it('reads each helper as one line to TalkBack', async () => {
    await render(inEnglish(<ModelSheetView visible voice="ready" photo="missing" onPrepare={jest.fn()} onClose={jest.fn()} />));
    expect(screen.getByLabelText(`${en['models.voice']}. ${en['models.ready']}. ${en['models.voiceBody']}`)).toBeTruthy();
  });

  it('speaks Hindi', async () => {
    await render(
      <LanguageProvider initialLanguage="hi">
        <ModelSheetView visible voice="ready" photo="ready" onPrepare={jest.fn()} onClose={jest.fn()} />
      </LanguageProvider>,
    );
    expect(screen.getByText(hi['models.title'])).toBeTruthy();
  });
});

describe('ModelDownloadSheet', () => {
  it('reads voice from the model service and looks for the photo models when opened', async () => {
    mockModels.isSTTLoaded = true;
    await render(inEnglish(<ModelDownloadSheet visible onClose={jest.fn()} />));
    await act(async () => {});
    expect(clipAvailable).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('model-voice-status')).toHaveTextContent(en['models.ready']);
    expect(screen.getByTestId('model-photo-status')).toHaveTextContent(en['models.ready']);
  });

  it('says photo search is not in this version when the models are missing', async () => {
    clipAvailable.mockResolvedValue(false);
    await render(inEnglish(<ModelDownloadSheet visible onClose={jest.fn()} />));
    await act(async () => {});
    expect(screen.getByTestId('model-photo-status')).toHaveTextContent(en['models.notInApp']);
  });

  it('reloads voice search from the fix button', async () => {
    await render(inEnglish(<ModelDownloadSheet visible onClose={jest.fn()} />));
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('model-prepare'));
    expect(mockModels.downloadAndLoadSTT).toHaveBeenCalledTimes(1);
  });

  it('does no work while closed', async () => {
    await render(inEnglish(<ModelDownloadSheet visible={false} onClose={jest.fn()} />));
    expect(clipAvailable).not.toHaveBeenCalled();
    expect(screen.queryByTestId('model-sheet')).toBeNull();
  });
});
