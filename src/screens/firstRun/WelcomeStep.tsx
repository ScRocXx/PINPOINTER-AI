import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Icon, Segmented } from '../../components/ui';
import { Language, useStrings } from '../../i18n';
import { Colors, Space } from '../../theme';
import { WelcomeArt } from './FirstRunArt';
import { StepDotsProps, StepFrame } from './StepFrame';

export interface WelcomeStepProps {
  dots: StepDotsProps;
  direction?: 1 | -1;
  onNext: () => void;
}

/**
 * Step 1: what Pinpointer does, in one line, and the language switch first
 * of all, so a Hindi reader can switch before reading anything else.
 */
export const WelcomeStep: React.FC<WelcomeStepProps> = ({ dots, direction, onNext }) => {
  const { t, lang, setLang } = useStrings();
  return (
    <StepFrame
      testID="first-run-welcome"
      direction={direction}
      dots={dots}
      top={
        <>
          <View />
          <Segmented<Language>
            accessibilityLabel={t('settings.language')}
            value={lang}
            onChange={setLang}
            options={[
              { value: 'en', label: t('lang.en'), accessibilityLabel: 'English' },
              { value: 'hi', label: t('lang.hi'), accessibilityLabel: 'Hindi, हिन्दी' },
            ]}
            style={styles.language}
            testID="first-run-language"
          />
        </>
      }
      actions={<Button label={t('onboarding.start')} onPress={onNext} block testID="first-run-start" />}
    >
      <WelcomeArt />
      <View style={styles.text}>
        <AppText variant="display" accessibilityRole="header">
          {t('onboarding.welcomeTitle')}
        </AppText>
        <AppText variant="body" color="textSecondary">
          {t('onboarding.welcomeBody')}
        </AppText>
        <View style={styles.private}>
          <Icon name="shield" size={22} color={Colors.found} strokeWidth={2} />
          <AppText variant="labelStrong" color="found" style={styles.flex}>
            {t('onboarding.private')}
          </AppText>
        </View>
      </View>
    </StepFrame>
  );
};

const styles = StyleSheet.create({
  language: { width: 220 },
  text: { gap: Space.md },
  private: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  flex: { flex: 1 },
});
