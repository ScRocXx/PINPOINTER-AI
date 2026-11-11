import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Icon, IconName, ProgressBar, Sheet } from './ui';
import { StringKey, useStrings } from '../i18n';
import { Colors, Radius, Space } from '../theme';

/** ready: works; loading: being loaded now; off: failed to load; missing: not in this build; checking: looking. */
export type HelperState = 'ready' | 'loading' | 'off' | 'missing' | 'checking';

interface HelperRowProps {
  icon: IconName;
  title: string;
  body: string;
  state: HelperState;
  testID: string;
}

const STATUS: Record<HelperState, { icon: IconName; color: string; key: StringKey }> = {
  ready: { icon: 'check', color: Colors.success, key: 'models.ready' },
  loading: { icon: 'clock', color: Colors.textSecondary, key: 'models.gettingReady' },
  checking: { icon: 'clock', color: Colors.textSecondary, key: 'models.checking' },
  off: { icon: 'alert', color: Colors.danger, key: 'models.notWorking' },
  missing: { icon: 'info', color: Colors.textSecondary, key: 'models.notInApp' },
};

/** One helper: what it does, and whether it works right now. */
const HelperRow: React.FC<HelperRowProps> = ({ icon, title, body, state, testID }) => {
  const { t } = useStrings();
  const status = STATUS[state];
  const ready = state === 'ready';
  return (
    <View style={styles.row} testID={testID} accessible accessibilityLabel={`${title}. ${t(status.key)}. ${body}`}>
      <View style={[styles.tile, ready ? styles.tileReady : styles.tileIdle]}>
        <Icon name={icon} size={24} color={ready ? Colors.onPrimarySoft : Colors.text} strokeWidth={2} />
      </View>
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="small" color="textSecondary">
          {body}
        </AppText>
        <View style={styles.status}>
          <Icon name={status.icon} size={18} color={status.color} strokeWidth={2.25} />
          <AppText variant="labelStrong" color={status.color} style={styles.flex} testID={`${testID}-status`}>
            {t(status.key)}
          </AppText>
        </View>
        {state === 'loading' ? <ProgressBar height={6} style={styles.bar} testID={`${testID}-bar`} /> : null}
      </View>
    </View>
  );
};

export interface ModelSheetViewProps {
  visible: boolean;
  voice: HelperState;
  photo: HelperState;
  /** Load voice search again when it failed. */
  onPrepare: () => void;
  onClose: () => void;
}

/** The sheet's look, with no data of its own (see ModelDownloadSheet). */
export const ModelSheetView: React.FC<ModelSheetViewProps> = ({ visible, voice, photo, onPrepare, onClose }) => {
  const { t } = useStrings();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('models.title')} testID="model-sheet">
      <AppText variant="small" color="textSecondary" style={styles.intro}>
        {t('models.body')}
      </AppText>
      <View style={styles.rows}>
        <HelperRow icon="mic" title={t('models.voice')} body={t('models.voiceBody')} state={voice} testID="model-voice" />
        <HelperRow icon="photos" title={t('models.photo')} body={t('models.photoBody')} state={photo} testID="model-photo" />
      </View>
      <View style={styles.privacy}>
        <Icon name="shield" size={20} color={Colors.found} strokeWidth={2} />
        <AppText variant="label" color="found" style={styles.flex}>
          {t('onboarding.private')}
        </AppText>
      </View>
      {voice === 'off' ? (
        <Button label={t('models.prepare')} icon="refresh" onPress={onPrepare} block testID="model-prepare" />
      ) : (
        <Button label={t('common.done')} onPress={onClose} variant="secondary" block testID="model-done" />
      )}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  intro: { marginBottom: Space.lg },
  rows: { gap: Space.xl, marginBottom: Space.xl },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.lg },
  tile: { width: 48, height: 48, borderRadius: Radius.sm - 2, alignItems: 'center', justifyContent: 'center' },
  tileReady: { backgroundColor: Colors.primarySoft },
  tileIdle: { backgroundColor: Colors.sunken },
  rowText: { flex: 1, gap: Space.xxs },
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: Space.xs },
  bar: { marginTop: Space.sm },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.lg },
  flex: { flex: 1 },
});
