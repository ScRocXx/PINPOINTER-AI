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

const { SherpaOnnxModule } = NativeModules;
const sherpaEmitter = new NativeEventEmitter(SherpaOnnxModule);

/**
 * useVoiceRecording — handles mic recording and STT via sherpa-onnx (on-device Whisper).
 * 100% offline. No internet needed. No Google dependency.
 * Returns transcribed text via `onTranscription` callback.
 */
export const useVoiceRecording = (onTranscription: (text: string) => void) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isModelLoading] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);
    const [recordingDuration, setRecordingDuration] = useState(0);

    const recordingStartRef = useRef(0);
    const audioLevelInterval = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        const onSpeechStart = sherpaEmitter.addListener('onSpeechStart', () => {
            setIsRecording(true);
            setIsTranscribing(false);
            recordingStartRef.current = Date.now();

            // Simulate audio level updates via interval while recording
            audioLevelInterval.current = setInterval(() => {
                if (recordingStartRef.current > 0) {
                    setRecordingDuration(Date.now() - recordingStartRef.current);
                    // Simulate audio level (sherpa-onnx doesn't provide real-time levels)
                    setAudioLevel(0.3 + Math.random() * 0.5);
                }
            }, 200);
        });

        const onSpeechEnd = sherpaEmitter.addListener('onSpeechEnd', () => {
            setIsRecording(false);
            setIsTranscribing(true);
            setAudioLevel(0);
            if (audioLevelInterval.current) {
                clearInterval(audioLevelInterval.current);
                audioLevelInterval.current = null;
            }
        });

        const onSpeechResults = sherpaEmitter.addListener('onSpeechResults', (event: any) => {
            setIsTranscribing(false);
            const text = event?.value?.[0] || '';
            if (text.trim()) {
                onTranscription(text.trim());
            }
        });

        const onSpeechError = sherpaEmitter.addListener('onSpeechError', (error: any) => {
            setIsRecording(false);
            setIsTranscribing(false);
            setAudioLevel(0);
            if (audioLevelInterval.current) {
                clearInterval(audioLevelInterval.current);
                audioLevelInterval.current = null;
            }
            AppLogger.error('VoiceRecording', 'Speech recognition error', error);
        });

        return () => {
            onSpeechStart.remove();
            onSpeechEnd.remove();
            onSpeechResults.remove();
            onSpeechError.remove();
            if (audioLevelInterval.current) {
                clearInterval(audioLevelInterval.current);
            }
        };
    }, [onTranscription]);

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

    const stopListening = useCallback(async () => {
        try {
            await SherpaOnnxModule.stopRecognition();
            setIsRecording(false);
            setAudioLevel(0);
        } catch (error) {
            AppLogger.error('VoiceRecording', 'Stop failed', error);
        }
    }, []);

    const cleanupRecording = useCallback(() => {
        SherpaOnnxModule.cancelRecognition().catch(() => {});
    }, []);

    return {
        isRecording,
        isTranscribing,
        isModelLoading,
        audioLevel,
        recordingDuration,
        startListening,
        stopListening,
        cleanupRecording,
    };
};
