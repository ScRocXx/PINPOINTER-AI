import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Elevation, HIT_SLOP, Radius, Touch } from '../../theme';
import { BeamGradient } from './Beam';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { PressableScale } from './PressableScale';

export type IconButtonVariant = 'plain' | 'tonal' | 'onNight' | 'beam' | 'primary';

export interface IconButtonProps {
  icon: IconName;
  /** Required: a button with no words must still say what it does. */
  label: string;
  onPress?: () => void;
  /**
   * - plain: icon only, on any light surface
   * - tonal: soft grey circle (header actions)
   * - onNight: for the dark photo viewer
   * - beam: the mic and the Scan button
   * - primary: violet circle
   */
  variant?: IconButtonVariant;
  /** Visual diameter. The touch area never drops below 48dp. Default 48. */
  size?: number;
  iconSize?: number;
  /** For toggles like the star: says "on" to TalkBack. */
  selected?: boolean;
  /** Fill the icon (a filled star when marked Important). */
  filled?: boolean;
  iconColor?: string;
  fillColor?: string;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ICON_COLOR: Record<IconButtonVariant, string> = {
  plain: Colors.text,
  tonal: Colors.text,
  onNight: Colors.onNight,
  beam: Colors.onPrimary,
  primary: Colors.onPrimary,
};

/** A round icon-only button with a required spoken label. */
export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  onPress,
  variant = 'plain',
  size = Touch.min,
  iconSize,
  selected,
  filled,
  iconColor,
  fillColor,
  disabled,
  accessibilityHint,
  style,
  testID,
}) => {
  const visual = Math.max(size, 32);
  const extra = Math.max(0, (Touch.min - visual) / 2);
  const hitSlop = extra > 0 ? { top: extra, bottom: extra, left: extra, right: extra } : HIT_SLOP;
  const color = iconColor ?? ICON_COLOR[variant];

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      pressedScale={0.92}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={selected === undefined ? undefined : { selected }}
      testID={testID}
      style={[
        styles.base,
        { width: visual, height: visual, borderRadius: Radius.pill },
        variantStyles[variant],
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {variant === 'beam' ? <BeamGradient style={StyleSheet.absoluteFill} /> : null}
      <View pointerEvents="none">
        <Icon
          name={icon}
          size={iconSize ?? Math.round(visual * 0.5)}
          color={color}
          strokeWidth={2}
          filled={filled}
          fillColor={fillColor}
        />
      </View>
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  disabled: { opacity: 0.4 },
});

const variantStyles = StyleSheet.create({
  plain: { backgroundColor: 'transparent' },
  tonal: { backgroundColor: Colors.sunken },
  onNight: { backgroundColor: 'rgba(255,255,255,0.14)' },
  beam: { backgroundColor: Colors.primary, ...Elevation.glow },
  primary: { backgroundColor: Colors.primary },
});
