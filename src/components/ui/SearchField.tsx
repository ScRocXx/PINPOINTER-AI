import React, { forwardRef, useState } from 'react';
import { StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

type FocusHandler = NonNullable<TextInputProps['onFocus']>;
type BlurHandler = NonNullable<TextInputProps['onBlur']>;
import { Colors, Elevation, Layout, MAX_FONT_SCALE, Radius, Space, Type } from '../../theme';
import { useStrings } from '../../i18n';
import { AppText } from './AppText';
import { BeamRing } from './Beam';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { PressableScale } from './PressableScale';

export interface SearchFieldProps
  extends Omit<TextInputProps, 'style' | 'value' | 'onChangeText' | 'placeholder'> {
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder: string;
  /** Called when the clear (×) button is tapped. Defaults to `onChangeText('')`. */
  onClear?: () => void;
  clearLabel?: string;
  /** Show the beam mic button. */
  onVoicePress?: () => void;
  voiceLabel?: string;
  /** The mic is listening: the ring stays on and the mic shows "stop". */
  listening?: boolean;
  stopVoiceLabel?: string;
  /**
   * Show the field as a big button that opens search (Home). Typing happens
   * on the search screen; this keeps Home calm and the keyboard closed.
   */
  onPressFake?: () => void;
  /** Force the beam ring on (e.g. while results load). Defaults to focus. */
  active?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The search field: white, 60dp, with the beam ring when it's in use and a
 * beam mic. The ring "locks on" when the field gets focus.
 */
export const SearchField = forwardRef<TextInput, SearchFieldProps>(
  (
    {
      value = '',
      onChangeText,
      placeholder,
      onClear,
      clearLabel,
      onVoicePress,
      voiceLabel,
      listening = false,
      stopVoiceLabel,
      onPressFake,
      active,
      containerStyle,
      testID = 'search-field',
      onFocus,
      onBlur,
      ...inputProps
    },
    ref,
  ) => {
    const { t } = useStrings();
    const [focused, setFocused] = useState(false);
    const ringOn = active ?? (focused || listening);

    const mic = onVoicePress ? (
      <IconButton
        icon={listening ? 'stop' : 'mic'}
        filled={listening}
        label={listening ? stopVoiceLabel ?? t('search.stopVoice') : voiceLabel ?? t('search.voice')}
        variant="beam"
        size={44}
        iconSize={22}
        onPress={onVoicePress}
        testID={`${testID}-voice`}
      />
    ) : null;

    if (onPressFake) {
      return (
        <BeamRing active={!!active} radius={Radius.sm} style={containerStyle} testID={testID}>
          <View style={styles.field}>
            <PressableScale
              onPress={onPressFake}
              accessibilityRole="search"
              accessibilityLabel={placeholder}
              style={styles.fakeTap}
              testID={`${testID}-open`}
            >
              <Icon name="search" size={24} color={Colors.textSecondary} strokeWidth={2} />
              <AppText variant="body" color="textMuted" numberOfLines={1} style={styles.flex}>
                {placeholder}
              </AppText>
            </PressableScale>
            {mic}
          </View>
        </BeamRing>
      );
    }

    const handleFocus: FocusHandler = e => {
      setFocused(true);
      onFocus?.(e);
    };
    const handleBlur: BlurHandler = e => {
      setFocused(false);
      onBlur?.(e);
    };

    return (
      <BeamRing active={ringOn} radius={Radius.sm} style={containerStyle} testID={testID}>
        <View style={styles.field}>
          <Icon name="search" size={24} color={ringOn ? Colors.primary : Colors.textSecondary} strokeWidth={2} />
          <TextInput
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={Colors.textMuted}
            selectionColor={Colors.primary}
            cursorColor={Colors.primary}
            returnKeyType="search"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityLabel={placeholder}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={styles.input}
            testID={`${testID}-input`}
            {...inputProps}
          />
          {value.length > 0 ? (
            <IconButton
              icon="close"
              label={clearLabel ?? t('search.clear')}
              size={36}
              iconSize={20}
              variant="tonal"
              onPress={onClear ?? (() => onChangeText?.(''))}
              testID={`${testID}-clear`}
            />
          ) : null}
          {mic}
        </View>
      </BeamRing>
    );
  },
);
SearchField.displayName = 'SearchField';

const styles = StyleSheet.create({
  field: {
    minHeight: Layout.searchFieldHeight,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Space.lg,
    paddingRight: Space.sm,
    gap: Space.sm,
    ...Elevation.raised,
  },
  fakeTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: Layout.searchFieldHeight,
  },
  flex: { flex: 1 },
  input: {
    ...Type.body,
    flex: 1,
    minWidth: 0,
    color: Colors.text,
    paddingVertical: Space.sm,
    includeFontPadding: false,
  },
});
