import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Elevation, Radius, Space, Touch } from '../../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { PressableScale } from './PressableScale';

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  /** Spoken label when the whole card is one button. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** No padding, for cards that start with a photo. */
  flush?: boolean;
  /** raised for floating cards; rest (default) for cards in a list. */
  elevation?: 'rest' | 'raised';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A white card with a hairline border. Tappable when given `onPress`. */
export const Card: React.FC<CardProps> = ({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  flush,
  elevation = 'rest',
  style,
  testID,
}) => {
  const cardStyle = [styles.card, Elevation[elevation], flush ? null : styles.padded, style];
  if (!onPress) {
    return (
      <View style={cardStyle} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={cardStyle}
      testID={testID}
    >
      {children}
    </PressableScale>
  );
};

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** An icon in a soft tile on the left. */
  icon?: IconName;
  iconTint?: { bg: string; ink: string };
  /** Anything on the left instead of the icon (a thumbnail). */
  leading?: React.ReactNode;
  /** Anything on the right instead of the chevron (a switch, a tag). */
  trailing?: React.ReactNode;
  /** Show a › when the row opens something. Default: true when tappable. */
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Leave out the divider under the last row of a group. */
  last?: boolean;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** One line in a list or a settings group. At least 64dp tall. */
export const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  icon,
  iconTint,
  leading,
  trailing,
  chevron,
  onPress,
  accessibilityLabel,
  last,
  danger,
  style,
  testID,
}) => {
  const showChevron = chevron ?? (!!onPress && !trailing);
  const tint = iconTint ?? { bg: Colors.sunken, ink: danger ? Colors.danger : Colors.text };
  const body = (
    <>
      {leading ??
        (icon ? (
          <View style={[styles.iconTile, { backgroundColor: tint.bg }]}>
            <Icon name={icon} size={24} color={tint.ink} strokeWidth={2} />
          </View>
        ) : null)}
      <View style={styles.text}>
        <AppText variant="bodyStrong" color={danger ? 'danger' : 'text'} numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" color="textSecondary" numberOfLines={3}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
      {showChevron ? <Icon name="chevronRight" size={22} color={Colors.textMuted} strokeWidth={2} /> : null}
    </>
  );
  const rowStyle = [styles.row, last ? null : styles.divider, style];

  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID} accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.985}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      style={rowStyle}
      testID={testID}
    >
      {body}
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
  },
  padded: { padding: Space.lg },
  row: {
    minHeight: Touch.comfortable + Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    backgroundColor: Colors.surface,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.line },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: Radius.xs + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: Space.xxs },
});
