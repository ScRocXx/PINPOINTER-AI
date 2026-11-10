import React, { useMemo } from 'react';
import { StyleSheet, TextProps } from 'react-native';
import { Colors, Fonts, TypeVariant } from '../../theme';
import { AppText } from './AppText';

export interface TextPart {
  text: string;
  match: boolean;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split `text` into plain and matching parts. Every term is matched, case
 * does not matter, and longer terms win when two overlap.
 */
export const splitMatches = (text: string, terms: ReadonlyArray<string>): TextPart[] => {
  const clean = Array.from(new Set(terms.map(t => t.trim()).filter(t => t.length > 0))).sort(
    (a, b) => b.length - a.length,
  );
  if (!text || clean.length === 0) {
    return text ? [{ text, match: false }] : [];
  }
  const pattern = new RegExp(`(${clean.map(escapeRegExp).join('|')})`, 'gi');
  const parts: TextPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const start = m.index;
    if (start > last) {
      parts.push({ text: text.slice(last, start), match: false });
    }
    parts.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), match: false });
  }
  return parts;
};

export interface HighlightedTextProps extends Omit<TextProps, 'children'> {
  text: string;
  /** The words to mark: the query and anything it was also searched as. */
  terms: ReadonlyArray<string>;
  variant?: TypeVariant;
  color?: string;
}

/**
 * Text with the searched words marked in "found" cyan, so the user sees why
 * a result matched. Marks every match, not only the first.
 */
export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  terms,
  variant = 'small',
  color = Colors.textSecondary,
  ...rest
}) => {
  const parts = useMemo(() => splitMatches(text, terms), [text, terms]);
  return (
    <AppText variant={variant} color={color} {...rest}>
      {parts.map((p, i) =>
        p.match ? (
          <AppText key={i} variant={variant} style={styles.match} testID="highlight-match">
            {p.text}
          </AppText>
        ) : (
          p.text
        ),
      )}
    </AppText>
  );
};

const styles = StyleSheet.create({
  match: {
    fontFamily: Fonts.bold,
    color: Colors.foundInk,
    backgroundColor: Colors.foundSoft,
  },
});
