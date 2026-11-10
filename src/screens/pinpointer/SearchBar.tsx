import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { styles } from './styles';

export interface SearchBarProps {
    /** true: the editable bar at the top of search; false: the bar on Home that opens search. */
    isTop: boolean;
    searchText: string;
    onChangeText: (text: string) => void;
    /** Called when the bar is tapped or focused (opens search). */
    onFocus: () => void;
    autoFocus: boolean;
    isRecording: boolean;
    isTranscribing: boolean;
    isModelLoading: boolean;
    onStartListening: () => void;
    onStopListening: () => void;
    inputRef?: React.Ref<TextInput>;
}

/** The search pill with the mic, or the four bouncing voice dots while recording. */
export const SearchBar: React.FC<SearchBarProps> = ({
    isTop,
    searchText,
    onChangeText,
    onFocus,
    autoFocus,
    isRecording,
    isTranscribing,
    isModelLoading,
    onStartListening,
    onStopListening,
    inputRef,
}) => {
    const gVoiceAnim1 = useRef(new Animated.Value(1)).current;
    const gVoiceAnim2 = useRef(new Animated.Value(1)).current;
    const gVoiceAnim3 = useRef(new Animated.Value(1)).current;
    const gVoiceAnim4 = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (isRecording) {
            const startBounce = (anim: Animated.Value, delay: number) => {
                Animated.loop(
                    Animated.sequence([
                        Animated.timing(anim, { toValue: 1.5, duration: 400, delay, useNativeDriver: true }),
                        Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true })
                    ])
                ).start();
            };
            startBounce(gVoiceAnim1, 0);
            startBounce(gVoiceAnim2, 150);
            startBounce(gVoiceAnim3, 300);
            startBounce(gVoiceAnim4, 450);
        } else {
            gVoiceAnim1.stopAnimation(); gVoiceAnim1.setValue(1);
            gVoiceAnim2.stopAnimation(); gVoiceAnim2.setValue(1);
            gVoiceAnim3.stopAnimation(); gVoiceAnim3.setValue(1);
            gVoiceAnim4.stopAnimation(); gVoiceAnim4.setValue(1);
        }
    }, [isRecording, gVoiceAnim1, gVoiceAnim2, gVoiceAnim3, gVoiceAnim4]);

    return (
        <View style={[styles.glassSearchBarContainer, isTop ? styles.searchBarTopSearch : styles.searchBarBottomNormal]}>
            {isRecording ? (
                <View style={styles.googleVoiceContainer}>
                    <Animated.View style={[styles.voiceCircle, styles.voiceCircleBlue, { transform: [{ scale: gVoiceAnim1 }] }]} />
                    <Animated.View style={[styles.voiceCircle, styles.voiceCircleRed, { transform: [{ scale: gVoiceAnim2 }] }]} />
                    <Animated.View style={[styles.voiceCircle, styles.voiceCircleYellow, { transform: [{ scale: gVoiceAnim3 }] }]} />
                    <Animated.View style={[styles.voiceCircle, styles.voiceCircleGreen, { transform: [{ scale: gVoiceAnim4 }] }]} />
                    <TouchableOpacity
                        style={styles.voiceStopButton}
                        onPress={onStopListening}
                        accessibilityLabel="Stop recording"
                        accessibilityRole="button"
                    >
                        <View style={styles.voiceStopSquare} />
                    </TouchableOpacity>
                </View>
            ) : (
                <Pressable onPressIn={!isTop ? onFocus : undefined} style={styles.glassSearchPill}>
                    <TextInput
                        ref={inputRef}
                        style={styles.glassSearchInput}
                        placeholder="Search on Pinpointer..."
                        placeholderTextColor="#6B7280"
                        value={searchText}
                        onChangeText={onChangeText}
                        onFocus={onFocus}
                        autoFocus={autoFocus}
                        pointerEvents={isTop ? 'auto' : 'none'}
                        editable={isTop}
                        accessibilityLabel="Search documents"
                    />
                    <TouchableOpacity
                        style={styles.glassMicButton}
                        onPress={onStartListening}
                        disabled={isTranscribing || isModelLoading}
                        accessibilityLabel="Start voice search"
                        accessibilityRole="button"
                    >
                        {isTranscribing || isModelLoading ? (
                            <Text style={styles.glassMicIcon}>⏳</Text>
                        ) : (
                            <View style={styles.micIconWrap}>
                                <View style={styles.micCapsule} />
                                <View style={styles.micArc} />
                                <View style={styles.micStem} />
                                <View style={styles.micBase} />
                            </View>
                        )}
                    </TouchableOpacity>
                </Pressable>
            )}
        </View>
    );
};
