import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  AppText,
  Card,
  Icon,
  ListRow,
  PinMark,
  Screen,
  ScreenHeader,
  SectionHeader,
  Segmented,
} from '../components/ui';
import { Language, useStrings } from '../i18n';
import { Colors, GUTTER, Radius, Space } from '../theme';
import { version as APP_VERSION } from '../../package.json';

/**
 * Settings: language, what Pinpointer does with your photos, and the version.
 * The first screen built entirely from the shared UI kit.
 */
export const SettingsScreen: React.FC = () => {
  const { t, lang, setLang } = useStrings();

  return (
    <Screen testID="settings-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title={t('settings.title')} />

        <SectionHeader title={t('settings.language')} />
        <View style={styles.gutter}>
          <Segmented<Language>
            accessibilityLabel={t('settings.language')}
            value={lang}
            onChange={setLang}
            options={[
              { value: 'en', label: t('lang.en'), accessibilityLabel: 'English' },
              { value: 'hi', label: t('lang.hi'), accessibilityLabel: 'Hindi, हिन्दी' },
            ]}
            testID="settings-language"
          />
        </View>

        <SectionHeader title={t('settings.privacy')} />
        <Card style={styles.gutter}>
          <View style={styles.privacy}>
            <View style={styles.shield}>
              <Icon name="shield" size={26} color={Colors.found} strokeWidth={2} />
            </View>
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              {t('settings.privacyBody')}
            </AppText>
          </View>
        </Card>

        <SectionHeader title={t('settings.about')} />
        <Card flush style={styles.gutter}>
          <ListRow
            title="Pinpointer"
            subtitle={t('settings.version', { v: APP_VERSION })}
            leading={<PinMark size={44} background={Colors.surface} />}
            last
            testID="settings-version"
          />
        </Card>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: { paddingBottom: Space.huge },
  gutter: { marginHorizontal: GUTTER },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  shield: {
    width: 44,
    height: 44,
    borderRadius: Radius.xs + 2,
    backgroundColor: Colors.foundSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
});
