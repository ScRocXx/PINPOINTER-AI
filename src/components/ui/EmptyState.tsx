import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Radius, Space } from '../../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { LockOnCorners } from './LockOnCorners';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Keep the corners closing in and out (while still searching). */
  searching?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * What a screen shows when there's nothing yet: an icon framed by the
 * lock-on corners, a plain title, one line on what to do, one button.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  searching = false,
  style,
  testID = 'empty-state',
}) => (
  <View style={[styles.wrap, style]} testID={testID}>
    <View style={styles.art}>
      <LockOnCorners searching={searching} inset={10} size={22} delay={120} />
      <Icon name={icon} size={40} color={Colors.primary} strokeWidth={1.75} />
    </View>
    <AppText variant="heading" align="center" accessibilityRole="header">
      {title}
    </AppText>
    {body ? (
      <AppText variant="body" color="textSecondary" align="center">
        {body}
      </AppText>
    ) : null}
    {actionLabel && onAction ? (
      <Button label={actionLabel} onPress={onAction} style={styles.action} testID={`${testID}-action`} />
    ) : null}
    {secondaryLabel && onSecondary ? (
      <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" style={styles.secondary} testID={`${testID}-secondary`} />
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: Space.xxl, paddingVertical: Space.xxxl, gap: Space.sm },
  art: {
    width: 88,
    height: 88,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.lg,
  },
  action: { alignSelf: 'center', marginTop: Space.md },
  secondary: { alignSelf: 'center' },
});
