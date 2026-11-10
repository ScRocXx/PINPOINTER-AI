import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '../../theme';
import { DOT_ICONS, FILLABLE_ICONS, ICON_PATHS, IconName } from './iconPaths';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Fill the shape too (star, play, stop). */
  filled?: boolean;
  fillColor?: string;
  /**
   * Give the icon a spoken name only when it stands alone. Icons inside a
   * labelled button stay silent (the default).
   */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * One SVG icon from the Pinpointer set. Replaces every emoji and unicode
 * glyph icon (⛶ ◷ ◈ ⟳ ✏️ 📤), which render differently on each phone.
 */
export const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color = Colors.text,
  strokeWidth = 1.75,
  filled = false,
  fillColor,
  accessibilityLabel,
  testID,
}) => {
  const fill = filled && FILLABLE_ICONS.has(name) ? fillColor ?? color : 'none';
  const width = DOT_ICONS.has(name) ? Math.max(strokeWidth, 3) : strokeWidth;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      testID={testID ?? `icon-${name}`}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      <Path
        d={ICON_PATHS[name]}
        fill={fill}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

export type { IconName };
