import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Beam, Duration, Ease } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export interface LockOnCornersProps {
  /** When true the corners close in on the box; when false they fade out. */
  active?: boolean;
  /** Length of each bracket arm. Default 18. */
  size?: number;
  thickness?: number;
  radius?: number;
  /** Space between the brackets and the thing they frame. Default 6. */
  inset?: number;
  /** One colour for all four corners instead of the beam colours. */
  color?: string;
  /** Wait before locking on (ms), e.g. until a photo has opened. */
  delay?: number;
  /** Keep closing in and out while something is being looked for. */
  searching?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Pinpointer's signature: four corner brackets that close in on what was
 * found (a word on a photo, the page being scanned). Lay it over the target
 * with absolute positioning; it fills its parent plus `inset` on each side.
 */
export const LockOnCorners: React.FC<LockOnCornersProps> = ({
  active = true,
  size = 18,
  thickness = 3,
  radius = 8,
  inset = 6,
  color,
  delay = 0,
  searching = false,
  style,
  testID = 'lock-on-corners',
}) => {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(active ? 1 : 0);
      return;
    }
    if (searching && active) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(progress, { toValue: 1, duration: Duration.slow, easing: Ease.standard, useNativeDriver: true }),
          Animated.timing(progress, { toValue: 0.55, duration: Duration.slow, easing: Ease.standard, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    const anim = Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: active ? Duration.slow : Duration.quick,
      delay: active ? delay : 0,
      easing: active ? Ease.standard : Ease.exit,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [active, delay, progress, reduceMotion, searching]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1.4, 1] });
  const [c1, c2, c3] = color ? [color, color, color] : Beam.colors;
  const arm = { position: 'absolute' as const, width: size, height: size };

  return (
    <Animated.View
      pointerEvents="none"
      testID={testID}
      style={[
        StyleSheet.absoluteFill,
        { top: -inset, left: -inset, right: -inset, bottom: -inset, opacity: progress, transform: [{ scale }] },
        style,
      ]}
    >
      <View style={[arm, styles.tl, { borderTopWidth: thickness, borderLeftWidth: thickness, borderColor: c1, borderTopLeftRadius: radius }]} />
      <View style={[arm, styles.tr, { borderTopWidth: thickness, borderRightWidth: thickness, borderColor: c2, borderTopRightRadius: radius }]} />
      <View style={[arm, styles.bl, { borderBottomWidth: thickness, borderLeftWidth: thickness, borderColor: c2, borderBottomLeftRadius: radius }]} />
      <View style={[arm, styles.br, { borderBottomWidth: thickness, borderRightWidth: thickness, borderColor: c3, borderBottomRightRadius: radius }]} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  tl: { top: 0, left: 0 },
  tr: { top: 0, right: 0 },
  bl: { bottom: 0, left: 0 },
  br: { bottom: 0, right: 0 },
});
