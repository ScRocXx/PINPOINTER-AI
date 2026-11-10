import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { GUTTER, Layout, Space } from '../../theme';
import { useStrings } from '../../i18n';
import { AppText } from './AppText';
import { Button } from './Button';
import { IconButton } from './IconButton';

export interface ScreenHeaderProps {
  title: string;
  /** A line under the title ("3,400 photos on this phone"). */
  subtitle?: string;
  /** Show a back arrow. */
  onBack?: () => void;
  backLabel?: string;
  /** Buttons on the right (IconButtons). */
  actions?: React.ReactNode;
  /** `large` for tab roots (title 26sp); `compact` for pushed screens. */
  size?: 'large' | 'compact';
  /** For the dark photo viewer. */
  onNight?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The top of a screen. The title is a TalkBack heading. */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  onBack,
  backLabel,
  actions,
  size = 'large',
  onNight = false,
  style,
  testID = 'screen-header',
}) => {
  const { t } = useStrings();
  const color = onNight ? 'onNight' : 'text';
  return (
    <View style={[styles.header, style]} testID={testID}>
      {onBack ? (
        <IconButton
          icon="back"
          label={backLabel ?? t('common.back')}
          onPress={onBack}
          variant={onNight ? 'onNight' : 'plain'}
          style={styles.back}
          testID={`${testID}-back`}
        />
      ) : null}
      <View style={styles.titles}>
        <AppText
          variant={size === 'large' ? 'title' : 'heading'}
          color={color}
          numberOfLines={2}
          accessibilityRole="header"
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" color={onNight ? 'onNightMuted' : 'textSecondary'} numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
};

export interface SectionHeaderProps {
  title: string;
  /** "See all" on the right. */
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The heading of a group on a screen ("Find quickly", "Important"). */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, actionLabel, onAction, style, testID }) => (
  <View style={[styles.section, style]} testID={testID}>
    <AppText variant="heading" accessibilityRole="header" style={styles.sectionTitle}>
      {title}
    </AppText>
    {actionLabel && onAction ? (
      <Button
        label={actionLabel}
        onPress={onAction}
        variant="ghost"
        size="compact"
        icon="chevronRight"
        iconAfter
        accessibilityLabel={`${actionLabel}: ${title}`}
      />
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  header: {
    minHeight: Layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    paddingVertical: Space.sm,
    gap: Space.sm,
  },
  back: { marginLeft: -Space.md },
  titles: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginRight: -Space.sm },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
    marginTop: Space.xxl,
    marginBottom: Space.sm,
    minHeight: 48,
  },
  sectionTitle: { flex: 1 },
});
