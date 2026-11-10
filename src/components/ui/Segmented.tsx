import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Elevation, Radius, Space, Touch } from '../../theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  accessibilityLabel?: string;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Spoken name of the whole control ("Language"). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Two or three choices side by side (English | हिन्दी, All | Photos | Papers).
 * The chosen one sits on a white raised pill.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
  testID = 'segmented',
}: SegmentedProps<T>): React.ReactElement {
  return (
    <View
      style={[styles.track, style]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <PressableScale
            key={opt.value}
            onPress={() => {
              if (!selected) {
                onChange(opt.value);
              }
            }}
            accessibilityRole="radio"
            accessibilityLabel={opt.accessibilityLabel ?? opt.label}
            accessibilityState={{ selected, checked: selected }}
            style={[styles.segment, selected ? styles.selected : null]}
            testID={`${testID}-${opt.value}`}
          >
            <AppText variant="labelStrong" color={selected ? 'text' : 'textSecondary'} numberOfLines={1}>
              {opt.label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: Colors.sunken,
    borderRadius: Radius.pill,
    padding: Space.xs,
    gap: Space.xs,
  },
  segment: {
    flex: 1,
    minHeight: Touch.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  selected: { backgroundColor: Colors.surface, ...Elevation.rest },
});
