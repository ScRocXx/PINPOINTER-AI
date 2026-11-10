import React, { useCallback, useRef } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { PRESS_SCALE, Spring } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** How far it shrinks while pressed. Default 0.97. */
  pressedScale?: number;
  children?: React.ReactNode;
}

/**
 * The base of everything tappable: shrinks a little while pressed and springs
 * back, so every tap feels answered. Respects Reduce Motion.
 */
export const PressableScale: React.FC<PressableScaleProps> = ({
  style,
  pressedScale = PRESS_SCALE,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();

  const animateTo = useCallback(
    (to: number) => {
      if (reduceMotion) {
        scale.setValue(1);
        return;
      }
      Animated.spring(scale, { toValue: to, ...Spring.press, useNativeDriver: true }).start();
    },
    [reduceMotion, scale],
  );

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      animateTo(pressedScale);
      onPressIn?.(e);
    },
    [animateTo, onPressIn, pressedScale],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      animateTo(1);
      onPressOut?.(e);
    },
    [animateTo, onPressOut],
  );

  return (
    <Pressable
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled, ...(rest.accessibilityState ?? {}) }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
};
