/**
 * A react-native-svg stand-in for the UI kit tests: the root <Svg> renders a
 * View (so testIDs and labels can be found); shapes render nothing.
 * The repo-wide mock in __mocks__/ renders Svg as null, which the screen
 * tests rely on, so only these tests use this one.
 */
import React from 'react';
import { View } from 'react-native';

const shape = () => null;
const Svg = (props: Record<string, unknown>) => (
  <View
    testID={props.testID as string}
    accessible={props.accessible as boolean}
    accessibilityLabel={props.accessibilityLabel as string}
    importantForAccessibility={props.importantForAccessibility as 'auto'}
  />
);

export default {
  __esModule: true,
  default: Svg,
  Svg,
  Path: shape,
  Circle: shape,
  G: shape,
  Defs: shape,
  LinearGradient: shape,
  Stop: shape,
};
