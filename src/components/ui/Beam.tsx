import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Beam, Duration, Ease } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export interface BeamGradientProps {
  style?: StyleProp<ViewStyle>;
  /** Run the beam left to right instead of on a slight diagonal. */
  horizontal?: boolean;
  children?: React.ReactNode;
  testID?: string;
}

/**
 * The brand gradient as a fill. Only for things that find: the Scan button,
 * the mic, progress fills, the active-tab mark. Never behind words.
 */
export const BeamGradient: React.FC<BeamGradientProps> = ({ style, horizontal, children, testID }) => (
  <LinearGradient
    testID={testID ?? 'beam-gradient'}
    colors={[...Beam.colors]}
    locations={[...Beam.locations]}
    start={horizontal ? { x: 0, y: 0.5 } : Beam.start}
    end={horizontal ? { x: 1, y: 0.5 } : Beam.end}
    style={style}
  >
    {children}
  </LinearGradient>
);

export interface BeamRingProps {
  /** Show the ring. When it turns on, it "locks on": closes in from 1.08x. */
  active: boolean;
  /** Ring thickness. Default 2.5. */
  thickness?: number;
  /** Corner radius of the content inside. The ring adds `thickness` to it. */
  radius: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  testID?: string;
}

/**
 * A beam-coloured ring around its child (the search field while searching).
 * The child keeps its size; the ring sits just outside it.
 */
export const BeamRing: React.FC<BeamRingProps> = ({ active, thickness = 2.5, radius, style, children, testID }) => {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(active ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: active ? Duration.base : Duration.quick,
      easing: active ? Ease.standard : Ease.exit,
      useNativeDriver: true,
    }).start();
  }, [active, progress, reduceMotion]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] });

  return (
    <View style={style} testID={testID}>
      <Animated.View
        pointerEvents="none"
        testID={testID ? `${testID}-ring` : 'beam-ring'}
        style={[
          StyleSheet.absoluteFill,
          {
            top: -thickness,
            left: -thickness,
            right: -thickness,
            bottom: -thickness,
            opacity: progress,
            transform: [{ scale }],
          },
        ]}
      >
        <BeamGradient horizontal style={[StyleSheet.absoluteFill, { borderRadius: radius + thickness }]} />
      </Animated.View>
      {children}
    </View>
  );
};
