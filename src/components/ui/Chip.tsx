import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Radius, Space, Tints, TintName, Touch } from '../../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { PressableScale } from './PressableScale';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Show a small × after the label (for removing a recent search). */
  removable?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A filter or suggestion. 48dp tall. Selected chips turn soft violet and get
 * a tick, so the state doesn't depend on colour alone.
 */
export const Chip: React.FC<ChipProps> = ({
  label,
  selected = false,
  onPress,
  icon,
  removable,
  accessibilityLabel,
  style,
  testID,
}) => {
  const fg = selected ? Colors.onPrimarySoft : Colors.text;
  const lead: IconName | undefined = selected ? 'check' : icon;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      testID={testID}
      style={[styles.chip, selected ? styles.selected : styles.idle, style]}
    >
      {lead ? <Icon name={lead} size={18} color={fg} strokeWidth={2.25} /> : null}
      <AppText variant="label" color={fg} numberOfLines={1}>
        {label}
      </AppText>
      {removable ? <Icon name="close" size={16} color={Colors.textSecondary} strokeWidth={2.25} /> : null}
    </PressableScale>
  );
};

export interface TagProps {
  label: string;
  /** A category tint, or `found` / `important` for result badges. */
  tone?: TintName | 'found' | 'important' | 'neutral';
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const toneColors = (tone: NonNullable<TagProps['tone']>): { bg: string; ink: string } => {
  switch (tone) {
    case 'found':
      return { bg: Colors.foundSoft, ink: Colors.foundInk };
    case 'important':
      return { bg: Colors.importantSoft, ink: Colors.importantInk };
    case 'neutral':
      return { bg: Colors.sunken, ink: Colors.textSecondary };
    default:
      return Tints[tone];
  }
};

/** A small label that can't be tapped ("Text match", "Bill", "PDF"). */
export const Tag: React.FC<TagProps> = ({ label, tone = 'neutral', icon, style, testID }) => {
  const { bg, ink } = toneColors(tone);
  return (
    <View style={[styles.tag, { backgroundColor: bg }, style]} testID={testID}>
      {icon ? <Icon name={icon} size={16} color={ink} strokeWidth={2.25} /> : null}
      <AppText variant="label" color={ink} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    minHeight: Touch.min,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs + 2,
    borderWidth: 1.5,
  },
  idle: { backgroundColor: Colors.surface, borderColor: Colors.lineStrong },
  selected: { backgroundColor: Colors.primarySoft, borderColor: Colors.primary },
  tag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.sm + 2,
    paddingVertical: Space.xxs,
  },
});
