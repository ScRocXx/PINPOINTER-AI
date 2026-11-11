import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Card, Icon, IconName, Reveal } from '../../components/ui';
import { Colors, Radius, Space } from '../../theme';

/** Plain promises with a green tick ("It never uploads a photo"). */
export const CheckPoints: React.FC<{ points: string[]; testID?: string }> = ({ points, testID = 'check-points' }) => (
  <View style={styles.list} testID={testID}>
    {points.map((point, i) => (
      <Reveal key={point} index={i + 2}>
        <View style={styles.row}>
          <View style={[styles.badge, styles.tick]}>
            <Icon name="check" size={20} color={Colors.success} strokeWidth={2.25} />
          </View>
          <AppText variant="body" style={styles.flex}>
            {point}
          </AppText>
        </View>
      </Reveal>
    ))}
  </View>
);

/** Numbered steps for a Settings screen the person hasn't seen ("1. Tap Open Settings"). */
export const NumberedSteps: React.FC<{ steps: string[]; testID?: string }> = ({ steps, testID = 'numbered-steps' }) => (
  <View style={styles.list} testID={testID}>
    {steps.map((step, i) => (
      <View key={step} style={styles.row}>
        <View style={[styles.badge, styles.number]}>
          <AppText variant="labelStrong" color="onPrimarySoft">
            {String(i + 1)}
          </AppText>
        </View>
        <AppText variant="body" style={styles.flex}>
          {step}
        </AppText>
      </View>
    ))}
  </View>
);

export interface NoticeProps {
  title: string;
  body?: string;
  icon?: IconName;
  children?: React.ReactNode;
  testID?: string;
}

/** A calm card for "not yet" moments: what happened and what to do, never an error red. */
export const Notice: React.FC<NoticeProps> = ({ title, body, icon = 'info', children, testID = 'notice' }) => (
  <Reveal>
    <Card testID={testID} style={styles.notice}>
      <View style={styles.row}>
        <View style={[styles.badge, styles.info]}>
          <Icon name={icon} size={20} color={Colors.onPrimarySoft} strokeWidth={2.25} />
        </View>
        <View style={[styles.flex, styles.noticeText]}>
          <AppText variant="bodyStrong" accessibilityRole="header">
            {title}
          </AppText>
          {body ? (
            <AppText variant="small" color="textSecondary">
              {body}
            </AppText>
          ) : null}
        </View>
      </View>
      {children}
    </Card>
  </Reveal>
);

const styles = StyleSheet.create({
  list: { gap: Space.md + 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md + 2 },
  badge: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tick: { backgroundColor: Colors.successSoft },
  number: { backgroundColor: Colors.primarySoft },
  info: { backgroundColor: Colors.primarySoft },
  flex: { flex: 1 },
  notice: { gap: Space.lg },
  noticeText: { gap: Space.xxs },
});
