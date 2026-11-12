import { useCallback } from 'react';
import { useToast } from '../components/ui/Toast';
import { tNow } from '../i18n/current';
import { usePinpointerShared } from './PinpointerContext';

/**
 * The tab bar's middle button: speak to search, from any tab.
 *
 * A tap goes to Home and starts listening; the search screen then opens by
 * itself and shows the listening panel (PinpointerScreen). A tap while
 * listening stops and searches. While the voice model is still loading it
 * says so instead of doing nothing.
 *
 * @returns `listening` (show "stop") and `press(goHome)`.
 */
export const useMicButton = () => {
    const toast = useToast();
    const { isRecording, isTranscribing, isModelLoading, startListening, stopListening } = usePinpointerShared();

    const press = useCallback((goHome: () => void) => {
        if (isRecording) {
            stopListening();
            return;
        }
        if (isTranscribing) return; // already turning speech into words
        if (isModelLoading) {
            toast.show(tNow('voice.gettingReady'), { icon: 'mic' });
            return;
        }
        goHome();
        startListening();
    }, [isRecording, isTranscribing, isModelLoading, startListening, stopListening, toast]);

    return { listening: isRecording, press };
};
