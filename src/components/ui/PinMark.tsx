import React from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { Colors } from '../../theme';

const PIN = 'M15 0C6.7 0 0 6.7 0 15c0 11 15 27 15 27s15-16 15-27C30 6.7 23.3 0 15 0z';

export interface PinMarkProps {
  size?: number;
  /** The colour behind the mark, used for the thin gap between the pins. */
  background?: string;
  accessibilityLabel?: string;
}

/**
 * The Pinpointer mark: two overlapping pins, cyan in front of violet.
 * (Refined from the original logo; see the design concept.)
 */
export const PinMark: React.FC<PinMarkProps> = ({ size = 32, background = Colors.canvas, accessibilityLabel }) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    testID="pin-mark"
    accessible={!!accessibilityLabel}
    accessibilityLabel={accessibilityLabel}
    importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
  >
    <Defs>
      <LinearGradient id="pinFront" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#1DB9CC" />
        <Stop offset="1" stopColor="#0E97AD" />
      </LinearGradient>
      <LinearGradient id="pinBack" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#7B5DF6" />
        <Stop offset="1" stopColor="#5A3FE0" />
      </LinearGradient>
    </Defs>
    <G transform="translate(27 17)">
      <Path d={PIN} fill="url(#pinBack)" />
      <Circle cx={15} cy={15} r={5.2} fill="#FFFFFF" opacity={0.85} />
    </G>
    <G transform="translate(7 5)">
      <Path d={PIN} fill="url(#pinFront)" stroke={background} strokeWidth={2.5} />
      <Circle cx={15} cy={15} r={5.6} fill="#FFFFFF" />
    </G>
  </Svg>
);
