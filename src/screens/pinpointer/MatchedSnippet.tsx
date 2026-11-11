import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { AppText, HighlightedText, LockOnCorners, splitMatches } from '../../components/ui';
import { Colors, Fonts, Type, TypeVariant } from '../../theme';

export interface MatchedSnippetProps {
  text: string;
  terms: ReadonlyArray<string>;
  variant?: TypeVariant;
  color?: string;
  numberOfLines?: number;
  /**
   * Close the lock-on corners in on the first matched word. Only when the
   * text starts with it (see `snippetFrom`), so its place is known exactly.
   */
  lockOn?: boolean;
  /** Wait before locking on (ms), so it follows the row rising in. */
  delay?: number;
  testID?: string;
}

/**
 * A result's text with every matched word marked in "found" cyan, and the
 * lock-on corners closing in on the first one: the moment Pinpointer shows
 * what it found. The corners need the word's width, so a hidden copy of it
 * is measured once in the same bold face.
 */
export const MatchedSnippet: React.FC<MatchedSnippetProps> = ({
  text,
  terms,
  variant = 'small',
  color = Colors.textSecondary,
  numberOfLines = 2,
  lockOn = false,
  delay = 0,
  testID = 'matched-snippet',
}) => {
  const first = useMemo(() => {
    const parts = splitMatches(text, terms);
    return parts[0]?.match ? parts[0].text : null;
  }, [text, terms]);
  const [boxWidth, setBoxWidth] = useState(0);
  const [wordWidth, setWordWidth] = useState(0);

  const showCorners = lockOn && !!first && wordWidth > 0 && (boxWidth === 0 || wordWidth < boxWidth - 1);
  const lineHeight = Type[variant].lineHeight;

  return (
    <View
      style={styles.wrap}
      onLayout={lockOn ? (e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width) : undefined}
      testID={testID}
    >
      <HighlightedText text={text} terms={terms} variant={variant} color={color} numberOfLines={numberOfLines} />
      {lockOn && first ? (
        <AppText
          variant={variant}
          numberOfLines={1}
          style={styles.measure}
          onLayout={e => setWordWidth(e.nativeEvent.layout.width)}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={`${testID}-measure`}
        >
          {first}
        </AppText>
      ) : null}
      {showCorners ? (
        <View pointerEvents="none" style={[styles.word, { width: wordWidth, height: lineHeight }]}>
          <LockOnCorners size={9} thickness={2} radius={4} inset={3} delay={delay} testID={`${testID}-corners`} />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  measure: { position: 'absolute', left: 0, top: 0, opacity: 0, fontFamily: Fonts.bold },
  word: { position: 'absolute', left: 0, top: 0 },
});
