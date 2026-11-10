import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Elevation, Radius, Space, Touch } from '../../theme';
import { AppText } from './AppText';
import { BeamGradient } from './Beam';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { PressableScale } from './PressableScale';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'beam';
export type ButtonSize = 'regular' | 'compact';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /**
   * - primary: the one main action on a screen (violet)
   * - secondary: white with a border
   * - ghost: text only, for "Not now" and links
   * - danger: removing something
   * - beam: only for finding things (Start searching, Scan)
   */
  variant?: ButtonVariant;
  /** regular is 56dp tall; compact is 48dp, for inside cards. */
  size?: ButtonSize;
  icon?: IconName;
  /** Put the icon after the label (for "See all ›"). */
  iconAfter?: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width. */
  block?: boolean;
  /** Spoken label when it should say more than `label`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const FG: Record<ButtonVariant, string> = {
  primary: Colors.onPrimary,
  secondary: Colors.text,
  ghost: Colors.primary,
  danger: Colors.onPrimary,
  beam: Colors.onPrimary,
};

/** The app's text button. Always 48dp or taller, label always visible. */
export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  icon,
  iconAfter = false,
  loading = false,
  disabled = false,
  block = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}) => {
  const fg = FG[variant];
  const inactive = disabled || loading;
  const iconNode = icon ? <Icon name={icon} size={22} color={fg} strokeWidth={2} /> : null;

  const content = (
    <View style={styles.row}>
      {loading ? <ActivityIndicator size="small" color={fg} testID={testID ? `${testID}-loading` : 'button-loading'} /> : null}
      {!loading && !iconAfter ? iconNode : null}
      <AppText variant="button" color={fg} numberOfLines={2} align="center" style={styles.label}>
        {label}
      </AppText>
      {!loading && iconAfter ? iconNode : null}
    </View>
  );

  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: loading }}
      testID={testID}
      style={[
        styles.base,
        size === 'compact' ? styles.compact : styles.regular,
        variantStyles[variant],
        block ? styles.block : styles.inline,
        inactive && !loading ? styles.disabled : null,
        style,
      ]}
    >
      {variant === 'beam' ? (
        <BeamGradient horizontal style={StyleSheet.absoluteFill} testID={testID ? `${testID}-beam` : undefined} />
      ) : null}
      {content}
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Space.xl,
    overflow: 'hidden',
  },
  regular: { minHeight: Touch.comfortable },
  compact: { minHeight: Touch.min, paddingHorizontal: Space.lg },
  block: { alignSelf: 'stretch' },
  inline: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: Space.sm },
  label: { flexShrink: 1 },
  disabled: { opacity: 0.45 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: Colors.primary, ...Elevation.rest },
  secondary: { backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.lineStrong },
  ghost: { backgroundColor: 'transparent', paddingHorizontal: Space.md },
  danger: { backgroundColor: Colors.danger },
  beam: { backgroundColor: Colors.primary, ...Elevation.glow },
});
