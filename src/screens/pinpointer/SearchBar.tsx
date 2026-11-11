import React from 'react';
import { StyleProp, TextInput, ViewStyle } from 'react-native';
import { SearchField } from '../../components/ui';
import { useStrings } from '../../i18n';

export interface SearchBarProps {
  /** true: the editable field at the top of search; false: a big button that opens search (Home). */
  isTop: boolean;
  searchText: string;
  onChangeText: (text: string) => void;
  /** Called when the field is focused, or tapped on Home (opens search). */
  onFocus: () => void;
  autoFocus: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  isModelLoading: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  /** Keep the beam ring on (search is looking). */
  active?: boolean;
  inputRef?: React.Ref<TextInput>;
  style?: StyleProp<ViewStyle>;
}

/**
 * The search field with the beam mic, from the UI kit. While listening the
 * ring stays on and the mic becomes a stop button; the search screen shows
 * the big listening panel underneath.
 */
export const SearchBar: React.FC<SearchBarProps> = ({
  isTop,
  searchText,
  onChangeText,
  onFocus,
  autoFocus,
  isRecording,
  isTranscribing,
  isModelLoading,
  onStartListening,
  onStopListening,
  active,
  inputRef,
  style,
}) => {
  const { t } = useStrings();
  const busy = isTranscribing || isModelLoading;
  const onVoice = isRecording ? onStopListening : busy ? undefined : onStartListening;

  if (!isTop) {
    // The mic on Home opens search too: the listening panel lives there.
    const onHomeVoice = () => {
      if (!isRecording) onFocus();
      onVoice?.();
    };
    return (
      <SearchField
        placeholder={t('search.placeholder')}
        onPressFake={onFocus}
        onVoicePress={onHomeVoice}
        listening={isRecording}
        containerStyle={style}
        testID="search-bar-home"
      />
    );
  }

  return (
    <SearchField
      ref={inputRef}
      value={searchText}
      onChangeText={onChangeText}
      onFocus={onFocus}
      autoFocus={autoFocus}
      placeholder={t('search.placeholder')}
      onVoicePress={onVoice ?? (() => {})}
      listening={isRecording}
      active={active || isRecording || busy ? true : undefined}
      editable={!isRecording}
      autoCorrect={false}
      autoCapitalize="none"
      containerStyle={style}
      testID="search-bar"
    />
  );
};
