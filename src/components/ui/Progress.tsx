import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Beam, Colors, Duration, Ease, Radius } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BeamGradient } from './Beam';

/** Keep a fraction between 0 and 1 (NaN and Infinity become 0). */
export const clampProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export interface ProgressBarProps {
  /** 0 to 1. Leave undefined while the total isn't known yet. */
  value?: number;
  height?: number;
  /** Spoken name, e.g. "Photos ready". TalkBack reads the percent too. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A beam-filled bar. The fill scales from the left on the native driver, so
 * it stays smooth while indexing keeps the JS thread busy.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  height = 10,
  accessibilityLabel,
  style,
  testID = 'progress-bar',
}) => {
  const reduceMotion = useReducedMotion();
  const indeterminate = value === undefined;
  const target = indeterminate ? 0.3 : clampProgress(value);
  const progress = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(target);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: target,
      duration: Duration.base,
      easing: Ease.standard,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, reduceMotion, target]);

  const percent = Math.round(target * 100);
  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2 }, style]}
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={indeterminate ? undefined : { min: 0, max: 100, now: percent }}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.fill,
          { borderRadius: height / 2, transform: [{ scaleX: progress }] },
        ]}
      >
        <BeamGradient horizontal style={StyleSheet.absoluteFill} testID={`${testID}-fill`} />
      </Animated.View>
    </View>
  );
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface ProgressRingProps {
  /** 0 to 1. */
  value: number;
  size?: number;
  thickness?: number;
  /** What sits in the middle (a count, a tick). */
  children?: React.ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A beam ring that fills clockwise from the top (first run "Getting ready"). */
export const ProgressRing: React.FC<ProgressRingProps> = ({
  value,
  size = 168,
  thickness = 12,
  children,
  accessibilityLabel,
  style,
  testID = 'progress-ring',
}) => {
  const reduceMotion = useReducedMotion();
  const target = clampProgress(value);
  const progress = useRef(new Animated.Value(target)).current;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(target);
      return;
    }
    // SVG props can't use the native driver; the ring moves rarely, so it's fine.
    const anim = Animated.timing(progress, {
      toValue: target,
      duration: Duration.slow,
      easing: Ease.standard,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, reduceMotion, target]);

  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });

  return (
    <View
      style={[{ width: size, height: size }, styles.ring, style]}
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="ringBeam" x1="0" y1="0" x2="1" y2="1">
            {Beam.colors.map((c, i) => (
              <Stop key={c} offset={String(Beam.locations[i])} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={Colors.sunken} strokeWidth={thickness} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ringBeam)"
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  track: { backgroundColor: Colors.sunken, overflow: 'hidden', borderRadius: Radius.pill },
  fill: { overflow: 'hidden', transformOrigin: 'left' },
  ring: { alignItems: 'center', justifyContent: 'center' },
});
