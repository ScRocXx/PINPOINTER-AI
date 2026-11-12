import React, { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Colors, Elevation, Layout, Space, Spring, Touch } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { AppText } from './AppText';
import { BeamGradient } from './Beam';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { PressableScale } from './PressableScale';

export interface TabBarItem {
  key: string;
  label: string;
  icon: IconName;
}

export interface TabBarProps {
  /** Four tabs: two go left of the mic button, two go right. */
  items: ReadonlyArray<TabBarItem>;
  activeKey: string;
  onSelect: (key: string) => void;
  /** The raised beam button in the middle: the mic, the thing that finds. */
  actionLabel: string;
  actionAccessibilityLabel?: string;
  onAction: () => void;
  /** Its icon. The mic unless told otherwise ("stop" while listening). */
  actionIcon?: IconName;
  /** Bottom safe-area inset (the gesture bar). */
  bottomInset?: number;
  /** Hide while the keyboard is open, so it never sits on top of it. */
  hideOnKeyboard?: boolean;
  testID?: string;
}

const INDICATOR_WIDTH = 28;

/**
 * The bottom tab bar. Labels always show (icons alone confuse first-time
 * users). The active tab gets a short beam mark that slides between tabs.
 */
export const TabBar: React.FC<TabBarProps> = ({
  items,
  activeKey,
  onSelect,
  actionLabel,
  actionAccessibilityLabel,
  onAction,
  actionIcon = 'mic',
  bottomInset = 0,
  hideOnKeyboard = true,
  testID = 'tab-bar',
}) => {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const half = Math.ceil(items.length / 2);
  const slots = items.length + 1;
  const activeIndex = items.findIndex(i => i.key === activeKey);
  const slotIndex = activeIndex < 0 ? -1 : activeIndex < half ? activeIndex : activeIndex + 1;
  const slotWidth = width / slots;
  const x = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);

  useEffect(() => {
    if (!hideOnKeyboard) {
      return;
    }
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [hideOnKeyboard]);

  useEffect(() => {
    if (width === 0 || slotIndex < 0) {
      return;
    }
    const to = slotIndex * slotWidth + (slotWidth - INDICATOR_WIDTH) / 2;
    if (reduceMotion || !placed.current) {
      placed.current = true;
      x.setValue(to);
      return;
    }
    Animated.spring(x, { toValue: to, ...Spring.gentle, useNativeDriver: true }).start();
  }, [reduceMotion, slotIndex, slotWidth, width, x]);

  if (keyboardOpen) {
    return null;
  }

  const renderTab = (item: TabBarItem) => {
    const active = item.key === activeKey;
    const color = active ? Colors.primary : Colors.textSecondary;
    return (
      <PressableScale
        key={item.key}
        onPress={() => onSelect(item.key)}
        pressedScale={0.94}
        accessibilityRole="tab"
        accessibilityLabel={item.label}
        accessibilityState={{ selected: active }}
        style={styles.tab}
        testID={`${testID}-${item.key}`}
      >
        <Icon name={item.icon} size={26} color={color} strokeWidth={active ? 2.25 : 1.9} />
        <AppText variant={active ? 'labelStrong' : 'label'} color={color} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {item.label}
        </AppText>
      </PressableScale>
    );
  };

  return (
    <View
      style={[styles.bar, { paddingBottom: bottomInset }]}
      accessibilityRole="tablist"
      testID={testID}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && slotIndex >= 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, { transform: [{ translateX: x }] }]}
          testID={`${testID}-indicator`}
        >
          <BeamGradient horizontal style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      <View style={styles.row}>
        {items.slice(0, half).map(renderTab)}
        <View style={styles.tab}>
          <PressableScale
            onPress={onAction}
            pressedScale={0.92}
            accessibilityRole="button"
            accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
            style={styles.fab}
            testID={`${testID}-action`}
          >
            <View style={styles.fabInner}>
              <BeamGradient style={StyleSheet.absoluteFill} />
              <Icon name={actionIcon} size={30} color={Colors.onPrimary} strokeWidth={2.25} />
            </View>
          </PressableScale>
          <AppText variant="labelStrong" color="primary" numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {actionLabel}
          </AppText>
        </View>
        {items.slice(half).map(renderTab)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.line,
  },
  row: { flexDirection: 'row', minHeight: Layout.tabBarHeight, alignItems: 'stretch' },
  tab: {
    flex: 1,
    minHeight: Touch.comfortable,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xxs,
    paddingTop: Space.sm,
    paddingBottom: Space.xs,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: INDICATOR_WIDTH,
    height: 4,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    overflow: 'hidden',
  },
  // The shadow sits on the outer ring; only the inner circle clips the beam.
  fab: {
    width: Touch.fab + 8,
    height: Touch.fab + 8,
    borderRadius: (Touch.fab + 8) / 2,
    marginTop: -Space.xxl - 4,
    padding: 4,
    backgroundColor: Colors.surface,
    ...Elevation.glow,
  },
  fabInner: {
    flex: 1,
    borderRadius: Touch.fab / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
