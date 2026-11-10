import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';
import { Duration, Ease, Stagger, staggerDelay } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export interface RevealProps {
  children: React.ReactNode;
  /** Position in a list: each item waits 40ms more (first 8 only). */
  index?: number;
  /** How far it rises, in dp. Default 12. */
  distance?: number;
  /** Change this to play the entrance again (e.g. a new query). */
  playKey?: string | number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Results and cards rise into place one after another, so the eye follows
 * the order. Items past the eighth appear at once; Reduce Motion skips it.
 */
export const Reveal: React.FC<RevealProps> = ({ children, index = 0, distance = 12, playKey, style, testID }) => {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion && index < Stagger.max;
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: Duration.base,
      delay: staggerDelay(index),
      easing: Ease.standard,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, index, playKey, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]} testID={testID}>
      {children}
    </Animated.View>
  );
};
