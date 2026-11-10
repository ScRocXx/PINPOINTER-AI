import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { AppText, Button, Card, Icon, IconButton, Reveal } from './ui';
import { useStrings } from '../i18n';
import { Colors, Radius, Space } from '../theme';

export interface PhotoAccessBannerViewProps {
  /** After one try that didn't give all photos: point to Settings instead. */
  settingsNext?: boolean;
  busy?: boolean;
  /** Sits in a screen's content (first run) instead of floating above the tab bar. */
  inline?: boolean;
  onAllow: () => void;
  onKeep: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The banner's look, with no data of its own (see PhotoAccessBanner). */
export const PhotoAccessBannerView: React.FC<PhotoAccessBannerViewProps> = ({
  settingsNext = false,
  busy = false,
  inline = false,
  onAllow,
  onKeep,
  style,
  testID = 'photo-access-banner',
}) => {
  const { t } = useStrings();
  return (
    <Reveal style={style} testID={testID}>
      <Card elevation={inline ? 'rest' : 'raised'} style={styles.card}>
        <View style={styles.row}>
          <View style={styles.badge}>
            <Icon name="photos" size={22} color={Colors.onPrimarySoft} strokeWidth={2} />
          </View>
          <View style={styles.text} accessible accessibilityRole="alert">
            <AppText variant="bodyStrong">{t('perm.limitedTitle')}</AppText>
            <AppText variant="small" color="textSecondary">
              {settingsNext ? t('perm.limitedSettingsBody') : t('perm.limitedBody')}
            </AppText>
          </View>
          <IconButton icon="close" label={t('perm.keepChoice')} onPress={onKeep} size={44} testID={`${testID}-keep`} />
        </View>
        <Button
          label={settingsNext ? t('perm.openSettings') : t('perm.allowAll')}
          icon={settingsNext ? 'open' : 'photos'}
          onPress={onAllow}
          loading={busy}
          size="compact"
          style={styles.action}
          testID={`${testID}-allow`}
        />
      </Card>
    </Reveal>
  );
};

const styles = StyleSheet.create({
  card: { gap: Space.md, padding: Space.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  badge: {
    width: 40,
    height: 40,
    borderRadius: Radius.xs + 2,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: Space.xxs },
  action: { marginLeft: 40 + Space.md },
});
