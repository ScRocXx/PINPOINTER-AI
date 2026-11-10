import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Elevation, Radius, Space, Tints, TintName } from '../../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { PressableScale } from './PressableScale';

export interface CollectionCardProps {
  label: string;
  icon: IconName;
  tint: TintName;
  /** "12 found". Leave out while counting. */
  countLabel?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A "Find quickly" tile on Home (ID cards, Bills, Medicine...). One tap runs
 * the search for that kind of thing, so nobody has to know what to type.
 */
export const CollectionCard: React.FC<CollectionCardProps> = ({
  label,
  icon,
  tint,
  countLabel,
  onPress,
  style,
  testID,
}) => {
  const { bg, ink } = Tints[tint];
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={countLabel ? `${label}, ${countLabel}` : label}
      style={[styles.card, style]}
      testID={testID}
    >
      <View style={[styles.iconTile, { backgroundColor: bg }]}>
        <Icon name={icon} size={26} color={ink} strokeWidth={2} />
      </View>
      <AppText variant="bodyStrong" numberOfLines={2}>
        {label}
      </AppText>
      {countLabel ? (
        <AppText variant="small" color="textSecondary" numberOfLines={1}>
          {countLabel}
        </AppText>
      ) : null}
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 124,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Space.lg,
    gap: Space.xs,
    ...Elevation.rest,
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm - 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.sm,
  },
});
