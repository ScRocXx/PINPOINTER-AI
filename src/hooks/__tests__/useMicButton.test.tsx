/**
 * The tab bar's middle button: speak to search.
 */
import { renderHook, act } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useMicButton } from '../useMicButton';

const mockShared = {
    isRecording: false,
    isTranscribing: false,
    isModelLoading: false,
    startListening: jest.fn(),
    stopListening: jest.fn(),
};

jest.mock('../PinpointerContext', () => ({
    usePinpointerShared: () => mockShared,
}));

const setup = async () => {
    const goHome = jest.fn();
    const { result } = await renderHook(() => useMicButton());
    return { result, goHome };
};

beforeEach(() => {
    Object.assign(mockShared, { isRecording: false, isTranscribing: false, isModelLoading: false });
    mockShared.startListening.mockClear();
    mockShared.stopListening.mockClear();
});

describe('useMicButton', () => {
    it('goes Home and starts listening', async () => {
        const { result, goHome } = await setup();
        await act(async () => result.current.press(goHome));
        expect(goHome).toHaveBeenCalled();
        expect(mockShared.startListening).toHaveBeenCalled();
        expect(result.current.listening).toBe(false);
    });

    it('while listening, a tap stops (and searches) instead of starting again', async () => {
        mockShared.isRecording = true;
        const { result, goHome } = await setup();
        expect(result.current.listening).toBe(true);
        await act(async () => result.current.press(goHome));
        expect(mockShared.stopListening).toHaveBeenCalled();
        expect(mockShared.startListening).not.toHaveBeenCalled();
        expect(goHome).not.toHaveBeenCalled();
    });

    it('waits while speech is being turned into words', async () => {
        mockShared.isTranscribing = true;
        const { result, goHome } = await setup();
        await act(async () => result.current.press(goHome));
        expect(mockShared.startListening).not.toHaveBeenCalled();
        expect(mockShared.stopListening).not.toHaveBeenCalled();
    });

    it('says voice search is getting ready instead of doing nothing', async () => {
        mockShared.isModelLoading = true;
        const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
        const { result, goHome } = await setup();
        await act(async () => result.current.press(goHome));
        expect(announce).toHaveBeenCalledWith(expect.stringContaining('getting ready'));
        expect(mockShared.startListening).not.toHaveBeenCalled();
        announce.mockRestore();
    });
});
