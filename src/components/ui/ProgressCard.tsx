import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Radius, Space } from '../../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { ProgressBar } from './Progress';

export type ProgressCardState = 'running' | 'paused' | 'done';

export interface ProgressCardProps {
  /** "Getting your photos ready" / "All 3,400 photos ready". */
  title: string;
  /** "1,240 of 3,400 · you can search now" / "Checked 2 min ago". */
  detail?: string;
  /** 0 to 1 while running; undefined while the total is unknown. */
  value?: number;
  state: ProgressCardState;
  icon?: IconName;
  /** The one action: Pause / Resume / Check again. */
  actionLabel?: string;
  onAction?: () => void;
  /** A quiet line under the bar ("Keeps going while charging"). */
  note?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Indexing progress in plain words. Running shows the beam bar; done turns
 * into a calm "ready" line with a green tick, so finished never looks busy.
 */
export const ProgressCard: React.FC<ProgressCardProps> = ({
  title,
  detail,
  value,
  state,
  icon = 'photos',
  actionLabel,
  onAction,
  note,
  style,
  testID = 'progress-card',
}) => {
  const done = state === 'done';
  return (
    <Card style={style} testID={testID}>
      <View style={styles.top}>
        <View style={[styles.badge, done ? styles.badgeDone : styles.badgeRunning]}>
          <Icon
            name={done ? 'check' : icon}
            size={24}
            color={done ? Colors.success : Colors.primary}
            strokeWidth={2.25}
          />
        </View>
        <View style={styles.text}>
          <AppText variant="bodyStrong" accessibilityRole="header">
            {title}
          </AppText>
          {detail ? (
            <AppText variant="small" color="textSecondary">
              {detail}
            </AppText>
          ) : null}
        </View>
      </View>
      {!done ? (
        <ProgressBar
          value={value}
          accessibilityLabel={title}
          style={styles.bar}
          testID={`${testID}-bar`}
        />
      ) : null}
      {note || (actionLabel && onAction) ? (
        <View style={styles.bottom}>
          {note ? (
            <AppText variant="small" color="textMuted" style={styles.note}>
              {note}
            </AppText>
          ) : (
            <View style={styles.note} />
          )}
          {actionLabel && onAction ? (
            <Button
              label={actionLabel}
              onPress={onAction}
              variant="secondary"
              size="compact"
              icon={state === 'running' ? 'pause' : state === 'paused' ? 'play' : 'refresh'}
              testID={`${testID}-action`}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  badge: { width: 44, height: 44, borderRadius: Radius.xs + 2, alignItems: 'center', justifyContent: 'center' },
  badgeRunning: { backgroundColor: Colors.primarySoft },
  badgeDone: { backgroundColor: Colors.successSoft },
  text: { flex: 1, gap: Space.xxs },
  bar: { marginTop: Space.lg },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: Space.md },
  note: { flex: 1 },
});
