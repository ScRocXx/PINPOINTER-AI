import { useState, useEffect, useCallback, useRef } from 'react';
import {
    PermissionsAndroid,
    Platform,
    Vibration,
    Alert,
    NativeModules,
    NativeEventEmitter,
} from 'react-native';
import { AppLogger } from '../utils/AppLogger';
import { createSilenceDetector, subscribeMicLevel } from '../utils/MicLevel';

const { SherpaOnnxModule } = NativeModules;
const sherpaEmitter = new NativeEventEmitter(SherpaOnnxModule);

/**
 * useVoiceRecording — handles mic recording and STT via sherpa-onnx (on-device Whisper).
 * 100% offline. No internet needed. No Google dependency.
 *
 * Listening ends by itself after the person stops speaking (or cancels when
 * nothing was said), so a tap on stop is optional. The live mic level is not
 * React state: the meter subscribes to it directly (`utils/MicLevel`).
 *
 * @param onTranscription Called with the trimmed transcript when recognition completes.
 * @returns Recording/transcribing flags and `startListening` / `stopListening`
 * / `cancelListening` controls.
 */
export const useVoiceRecording = (onTranscription: (text: string) => void) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isModelLoading] = useState(false);

    // Set while we cancel on purpose: the "end" event that follows must not
    // show "Understanding…", because no words will come.
    const cancellingRef = useRef(false);
    // Cancelled while the words were being read: drop them when they arrive.
    const discardRef = useRef(false);
    // One stop or cancel per recording, whoever asks first (tap or silence).
    const endingRef = useRef(false);
    const levelUnsubRef = useRef<(() => void) | null>(null);

    const stopLevelWatch = useCallback(() => {
        levelUnsubRef.current?.();
        levelUnsubRef.current = null;
    }, []);

    const stopListening = useCallback(async () => {
        if (endingRef.current) return;
        endingRef.current = true;
        stopLevelWatch();
        try {
            await SherpaOnnxModule.stopRecognition();
            setIsRecording(false);
        } catch (error) {
            AppLogger.error('VoiceRecording', 'Stop failed', error);
        }
    }, [stopLevelWatch]);

    const cancelListening = useCallback(async () => {
        if (endingRef.current) {
            // Already stopped and reading the words: don't search with them.
            discardRef.current = true;
            setIsTranscribing(false);
            return;
        }
        endingRef.current = true;
        cancellingRef.current = true;
        stopLevelWatch();
        try {
            await SherpaOnnxModule.cancelRecognition();
        } catch (error) {
            AppLogger.warn('VoiceRecording', 'Cancel failed', error);
        }
        setIsRecording(false);
        setIsTranscribing(false);
    }, [stopLevelWatch]);

    // Refs so the native listeners (set up once) always call the latest ones.
    const stopRef = useRef(stopListening);
    const cancelRef = useRef(cancelListening);
    useEffect(() => {
        stopRef.current = stopListening;
        cancelRef.current = cancelListening;
    }, [stopListening, cancelListening]);

    useEffect(() => {
        const onSpeechStart = sherpaEmitter.addListener('onSpeechStart', () => {
            setIsRecording(true);
            setIsTranscribing(false);
            endingRef.current = false;
            cancellingRef.current = false;
            discardRef.current = false;

            // End by itself once the person has finished speaking.
            levelUnsubRef.current?.();
            const detector = createSilenceDetector(Date.now());
            levelUnsubRef.current = subscribeMicLevel(level => {
                const verdict = detector.push(level);
                if (verdict === 'stop') stopRef.current();
                else if (verdict === 'cancel') cancelRef.current();
            });
        });

        const onSpeechEnd = sherpaEmitter.addListener('onSpeechEnd', () => {
            levelUnsubRef.current?.();
            levelUnsubRef.current = null;
            setIsRecording(false);
            if (cancellingRef.current) {
                cancellingRef.current = false;
                setIsTranscribing(false);
            } else {
                setIsTranscribing(true);
            }
        });

        const onSpeechResults = sherpaEmitter.addListener('onSpeechResults', (event: { value?: string[] }) => {
            setIsTranscribing(false);
            if (discardRef.current) {
                discardRef.current = false;
                return;
            }
            const text = event?.value?.[0] || '';
            if (text.trim()) {
                onTranscription(text.trim());
            }
        });

        const onSpeechError = sherpaEmitter.addListener('onSpeechError', (error: unknown) => {
            levelUnsubRef.current?.();
            levelUnsubRef.current = null;
            setIsRecording(false);
            setIsTranscribing(false);
            AppLogger.error('VoiceRecording', 'Speech recognition error', error);
        });

        return () => {
            onSpeechStart.remove();
            onSpeechEnd.remove();
            onSpeechResults.remove();
            onSpeechError.remove();
        };
    }, [onTranscription]);

    // Only on unmount: a new onTranscription must not cut off a live recording's level.
    useEffect(() => () => {
        levelUnsubRef.current?.();
        levelUnsubRef.current = null;
    }, []);

    const startListening = useCallback(async () => {
        try {
            Vibration.vibrate(40);

            if (Platform.OS === 'android') {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
                );
                if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                    Alert.alert('Permission Denied', 'Microphone permission is required for voice search.');
                    return;
                }
            }

            await SherpaOnnxModule.startRecognition();
        } catch (error) {
            AppLogger.error('VoiceRecording', 'Start failed', error);
            Vibration.vibrate([0, 30, 50, 30]);
            Alert.alert('Voice Error', 'Could not start voice recognition. Please try again.');
        }
    }, []);

    const cleanupRecording = useCallback(() => {
        levelUnsubRef.current?.();
        levelUnsubRef.current = null;
        SherpaOnnxModule.cancelRecognition().catch(() => {});
    }, []);

    return {
        isRecording,
        isTranscribing,
        isModelLoading,
        startListening,
        stopListening,
        cancelListening,
        cleanupRecording,
    };
};
