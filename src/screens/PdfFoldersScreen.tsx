import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import {
  AppText,
  Button,
  Card,
  Icon,
  ListRow,
  Reveal,
  Screen,
  ScreenHeader,
  SectionHeader,
  Sheet,
  Tag,
} from '../components/ui';
import { Colors, GUTTER, Radius, Space, Tints } from '../theme';
import { useStrings } from '../i18n';
import { RootStackParamList } from '../navigation/types';
import { usePdfPlaces } from '../hooks/usePdfPlaces';
import type { PdfFolder } from '../utils/PdfImport';

/**
 * Where Pinpointer looks: the places it reads PDFs from, in one screen
 * instead of a pop-up.
 *
 * - Downloads and Documents, with "Allow" when All files access is off.
 * - The folders the person chose, each with Remove (asks first; papers
 *   already found stay searchable), and "Add a folder".
 * - Single PDFs picked one by one, and the Share tip.
 *
 * Every change shows a short confirmation and starts looking for papers.
 */
export const PdfFoldersScreen: React.FC = () => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { t } = useStrings();
  const places = usePdfPlaces();
  const [removing, setRemoving] = useState<PdfFolder | null>(null);
  const [busy, setBusy] = useState(false);

  const showStandard = places.standard || places.canAskStandard;
  // The one main action: allowing Downloads and Documents when that's off,
  // adding a folder otherwise.
  const allowIsMain = !places.standard && places.canAskStandard;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const status = (
    <Tag
      label={t(places.standard ? 'folders.looking' : 'folders.needsPermission')}
      tone={places.standard ? 'found' : 'neutral'}
      icon={places.standard ? 'check' : 'lock'}
    />
  );

  return (
    <Screen wash testID="folders-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title={t('papers.whereLooks')}
          subtitle={t('folders.subtitle')}
          onBack={() => navigation.goBack()}
          size="compact"
        />

        {showStandard ? (
          <>
            <SectionHeader title={t('folders.onPhone')} />
            <Card flush style={styles.gutter}>
              <ListRow icon="folder" title={t('folders.downloads')} trailing={status} testID="folders-downloads" />
              <ListRow icon="folder" title={t('folders.documents')} trailing={status} last testID="folders-documents" />
            </Card>
            {allowIsMain ? (
              <Card style={[styles.gutter, styles.allow]} testID="folders-allow-card">
                <View style={styles.allowRow}>
                  <View style={[styles.badge, { backgroundColor: Colors.primarySoft }]}>
                    <Icon name="lock" size={24} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{t('folders.allowTitle')}</AppText>
                    <AppText variant="small" color="textSecondary">
                      {t('folders.allowBody')}
                    </AppText>
                  </View>
                </View>
                <Button
                  label={t('folders.allow')}
                  onPress={() => run(places.allowStandard)}
                  disabled={busy}
                  block
                  testID="folders-allow"
                />
              </Card>
            ) : null}
          </>
        ) : null}

        {places.canPick ? (
          <>
            <SectionHeader title={t('folders.chosen')} />
            {places.folders.length > 0 ? (
              <Card flush style={styles.gutter} testID="folders-list">
                {places.folders.map((folder, i) => (
                  <Reveal key={folder.uri} index={i}>
                    <ListRow
                      icon="folder"
                      iconTint={Tints.bank}
                      title={folder.name}
                      subtitle={t('folders.chosenHint')}
                      last={i === places.folders.length - 1}
                      trailing={
                        <Button
                          label={t('common.remove')}
                          accessibilityLabel={t('folders.remove', { name: folder.name })}
                          onPress={() => setRemoving(folder)}
                          variant="secondary"
                          size="compact"
                          testID={`folders-remove-${i}`}
                        />
                      }
                      testID={`folders-folder-${i}`}
                    />
                  </Reveal>
                ))}
              </Card>
            ) : places.ready ? (
              <Card style={styles.gutter} testID="folders-empty">
                <AppText variant="body" color="textSecondary">
                  {t('folders.chosenEmpty')}
                </AppText>
              </Card>
            ) : null}
            <Button
              label={t('folders.add')}
              icon="plus"
              variant={allowIsMain ? 'secondary' : 'primary'}
              onPress={() => run(places.addFolder)}
              disabled={busy}
              block
              style={styles.gutter}
              testID="folders-add"
            />

            <SectionHeader title={t('folders.single')} />
            <Card style={[styles.gutter, styles.stack]}>
              <AppText variant="body" color="textSecondary">
                {t('folders.singleBody')}
              </AppText>
              <Button
                label={t('papers.pickPdfs')}
                icon="papers"
                variant="secondary"
                onPress={() => run(places.addFiles)}
                disabled={busy}
                block
                testID="folders-pick"
              />
            </Card>

            <SectionHeader title={t('folders.shareTitle')} />
            <Card style={styles.gutter}>
              <View style={styles.allowRow}>
                <View style={[styles.badge, { backgroundColor: Colors.sunken }]}>
                  <Icon name="share" size={24} color={Colors.text} strokeWidth={2} />
                </View>
                <AppText variant="body" color="textSecondary" style={styles.flex}>
                  {t('papers.shareTip')}
                </AppText>
              </View>
            </Card>
          </>
        ) : null}

        <View style={styles.privacy}>
          <Icon name="shield" size={22} color={Colors.found} strokeWidth={2} />
          <AppText variant="small" color="textSecondary" style={styles.flex}>
            {t('folders.private')}
          </AppText>
        </View>
      </ScrollView>

      <Sheet
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? t('folders.removeTitle', { name: removing.name }) : undefined}
        testID="folders-remove-sheet"
      >
        <AppText variant="body" color="textSecondary">
          {t('folders.removeBody')}
        </AppText>
        <View style={styles.sheetActions}>
          <Button
            label={t('common.remove')}
            variant="danger"
            block
            onPress={() => {
              const folder = removing;
              setRemoving(null);
              if (folder) {
                run(() => places.removeFolder(folder));
              }
            }}
            testID="folders-remove-confirm"
          />
          <Button label={t('common.cancel')} variant="ghost" block onPress={() => setRemoving(null)} />
        </View>
      </Sheet>
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: { paddingBottom: Space.huge },
  flex: { flex: 1 },
  gutter: { marginHorizontal: GUTTER, marginBottom: Space.md },
  allow: { gap: Space.lg },
  allowRow: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  badge: {
    width: 44,
    height: 44,
    borderRadius: Radius.xs + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: { gap: Space.md },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginHorizontal: GUTTER,
    marginTop: Space.xxl,
  },
  sheetActions: { gap: Space.sm, marginTop: Space.xl },
});
