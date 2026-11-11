import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { AppText, BeamGradient, Icon, LockOnCorners, PressableScale } from '../../components/ui';
import { useStrings } from '../../i18n';
import { Colors, Elevation, GUTTER, Radius, Space } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { subscribeMicLevel } from '../../utils/MicLevel';

export interface ListeningPanelProps {
  /** Recording: the rings follow the voice and a tap stops. */
  listening: boolean;
  /** Recording ended; Whisper is turning it into words. */
  understanding: boolean;
  onStop: () => void;
  testID?: string;
}

const ORB = 104;
/** How far each ring grows at full voice. Quiet rooms barely move them. */
const RINGS = [
  { reach: 0.45, opacity: 0.22 },
  { reach: 0.85, opacity: 0.13 },
  { reach: 1.3, opacity: 0.07 },
];

/**
 * The real microphone level, as an Animated value (0..1) that never touches
 * React state: each reading eases the value on the native driver.
 */
const useMicLevel = (active: boolean, reduceMotion: boolean): Animated.Value => {
  const level = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      level.setValue(0);
      return;
    }
    const stop = subscribeMicLevel(v => {
      if (reduceMotion) {
        level.setValue(v);
        return;
      }
      Animated.timing(level, { toValue: v, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    });
    return () => {
      stop();
      level.stopAnimation();
      level.setValue(0);
    };
  }, [active, level, reduceMotion]);
  return level;
};

/**
 * Voice search, clearly: a big beam mic whose rings grow with the person's
 * voice (the real level from the microphone), "Listening… tap to stop",
 * and a note that it stops by itself. Then "Understanding…" with the
 * corners searching while the words are worked out.
 */
export const ListeningPanel: React.FC<ListeningPanelProps> = ({ listening, understanding, onStop, testID = 'listening-panel' }) => {
  const { t } = useStrings();
  const reduceMotion = useReducedMotion();
  const level = useMicLevel(listening, reduceMotion);

  useEffect(() => {
    if (listening) AccessibilityInfo.announceForAccessibility(t('search.listening'));
    else if (understanding) AccessibilityInfo.announceForAccessibility(t('search.understanding'));
  }, [listening, understanding, t]);

  const title = listening ? t('search.listening') : t('search.understanding');
  const hint = listening ? t('search.listeningHint') : t('search.understandingHint');

  return (
    <View style={styles.wrap} testID={testID}>
      <PressableScale
        onPress={listening ? onStop : undefined}
        disabled={!listening}
        pressedScale={0.94}
        accessibilityRole="button"
        accessibilityLabel={listening ? t('search.stopVoice') : title}
        accessibilityHint={listening ? t('search.stopsByItself') : undefined}
        style={styles.stage}
        testID={`${testID}-stop`}
      >
        {RINGS.map((ring, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            testID={`${testID}-ring`}
            style={[
              styles.ring,
              {
                opacity: ring.opacity,
                transform: [{ scale: level.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + ring.reach] }) }],
              },
            ]}
          >
            <BeamGradient style={StyleSheet.absoluteFill} />
          </Animated.View>
        ))}
        <View style={styles.orb}>
          <BeamGradient style={StyleSheet.absoluteFill} />
          <Icon name={listening ? 'stop' : 'mic'} size={40} color={Colors.onPrimary} filled={listening} strokeWidth={2} />
        </View>
        {understanding ? (
          <View pointerEvents="none" style={styles.corners}>
            <LockOnCorners searching inset={8} size={22} />
          </View>
        ) : null}
      </PressableScale>

      <AppText variant="title" align="center" accessibilityLiveRegion="polite" testID={`${testID}-title`}>
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {hint}
      </AppText>
      {listening ? (
        <AppText variant="small" color="textMuted" align="center">
          {t('search.stopsByItself')}
        </AppText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: GUTTER + Space.sm,
    paddingBottom: Space.huge * 2,
    gap: Space.sm,
  },
  stage: {
    width: ORB * 2.4,
    height: ORB * 2.4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.lg,
  },
  ring: {
    position: 'absolute',
    width: ORB,
    height: ORB,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...Elevation.glow,
  },
  corners: { position: 'absolute', width: ORB, height: ORB },
});
