import React from 'react';
import { StatusBar, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../theme';
import { useScreenFocus } from '../../hooks/useScreenFocus';

export type ScreenTone = 'canvas' | 'surface' | 'night';

export interface ScreenProps {
  children: React.ReactNode;
  /** canvas (most screens), surface (white forms), night (photo viewer). */
  tone?: ScreenTone;
  /** Pad for the status bar. Turn off when a photo should run under it. */
  padTop?: boolean;
  /** Pad for the gesture bar. Off by default: the tab bar already does. */
  padBottom?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const BACKGROUND: Record<ScreenTone, string> = {
  canvas: Colors.canvas,
  surface: Colors.surface,
  night: Colors.night,
};

/**
 * The frame of every screen: background colour, safe-area padding and the
 * matching status bar icons (dark on light screens, light in the viewer).
 * Android 15+ draws the app edge to edge, so screens must pad themselves.
 */
export const Screen: React.FC<ScreenProps> = ({
  children,
  tone = 'canvas',
  padTop = true,
  padBottom = false,
  style,
  testID,
}) => {
  const insets = useSafeAreaInsets();
  // Tabs stay mounted in the background; only the visible screen sets the
  // status bar, or a hidden light screen would leave dark icons on a dark one.
  const focused = useScreenFocus();
  return (
    <View
      style={[
        styles.root,
        { backgroundColor: BACKGROUND[tone] },
        padTop ? { paddingTop: insets.top } : null,
        padBottom ? { paddingBottom: insets.bottom } : null,
        style,
      ]}
      testID={testID}
    >
      {focused ? (
        <StatusBar
          barStyle={tone === 'night' ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent
        />
      ) : null}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
});
