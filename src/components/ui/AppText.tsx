import React from 'react';
import { StyleProp, Text, TextProps, TextStyle } from 'react-native';
import { ColorName, Colors, MAX_FONT_SCALE, Type, TypeVariant } from '../../theme';

export interface AppTextProps extends TextProps {
  /** Type style from the scale. Default `body` (18sp). */
  variant?: TypeVariant;
  /** A semantic colour name, or any colour string. Default `text`. */
  color?: ColorName | string;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
}

const resolveColor = (color: ColorName | string): string =>
  color in Colors ? Colors[color as ColorName] : color;

/**
 * Every piece of text in the app. Picks the Mukta face, size and line height
 * from the type scale, and follows the phone's font size up to 1.5x.
 */
export const AppText: React.FC<AppTextProps> = ({
  variant = 'body',
  color = 'text',
  align,
  style,
  maxFontSizeMultiplier = MAX_FONT_SCALE,
  ...rest
}) => (
  <Text
    maxFontSizeMultiplier={maxFontSizeMultiplier}
    style={[Type[variant], { color: resolveColor(color) }, align ? { textAlign: align } : null, style]}
    {...rest}
  />
);
