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
import type { DocumentAccess, PhotoAccess } from '../utils/StoragePermissions';
import { version as APP_VERSION } from '../../package.json';

export interface SettingsViewProps {
  /** null while still checking. */
  photoAccess: PhotoAccess | null;
  docAccess: DocumentAccess | null;
  voice: 'ready' | 'loading' | 'off';
  onChangePhotos: () => void;
  onChangePapers: () => void;
  onOpenHelpers: () => void;
  /** The voice and photo search sheet, placed by the container. */
  sheet?: React.ReactNode;
}

/** Settings as a picture of the state it's given (see SettingsScreen). */
export const SettingsView: React.FC<SettingsViewProps> = ({
  photoAccess,
  docAccess,
  voice,
  onChangePhotos,
  onChangePapers,
  onOpenHelpers,
  sheet,
}) => {
  const { t, lang, setLang } = useStrings();

  const photoStatus =
    photoAccess === 'full'
      ? t('settings.photosAll')
      : photoAccess === 'limited'
        ? t('settings.photosSome')
        : photoAccess === null
          ? undefined
          : t('settings.photosOff');
  const papersStatus =
    docAccess === 'all'
      ? t('settings.papersAll')
      : docAccess === 'folders'
        ? t('settings.papersFolders')
        : docAccess === null
          ? undefined
          : t('settings.papersOff');
  const helpersStatus =
    voice === 'ready' ? t('settings.helpersReady') : voice === 'loading' ? t('settings.helpersLoading') : t('settings.helpersOff');

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

        <SectionHeader title={t('settings.access')} />
        <Card flush style={styles.gutter}>
          <ListRow
            icon="photos"
            title={t('tab.photos')}
            subtitle={photoStatus}
            onPress={onChangePhotos}
            testID="settings-photos"
          />
          <ListRow
            icon="papers"
            title={t('tab.papers')}
            subtitle={papersStatus}
            onPress={onChangePapers}
            last
            testID="settings-papers"
          />
        </Card>

        <SectionHeader title={t('settings.search')} />
        <Card flush style={styles.gutter}>
          <ListRow
            icon="mic"
            title={t('settings.helpers')}
            subtitle={helpersStatus}
            onPress={onOpenHelpers}
            last
            testID="settings-helpers"
          />
        </Card>

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
      {sheet}
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
