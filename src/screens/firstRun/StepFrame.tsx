import React, { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, View } from 'react-native';
import { useStrings } from '../../i18n';
import { Colors, Duration, Ease, GUTTER, Radius, Space } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** Width of the active step dot; idle dots are round. */
const DOT = 8;
const DOT_ACTIVE = 24;

export interface StepDotsProps {
  /** The step on show, from 0. */
  index: number;
  count: number;
  /** The step we came from, so the pill slides from there. */
  from?: number;
}

/**
 * "Step 2 of 4" as dots. The active one is a violet pill that stretches
 * across from the previous step. TalkBack reads the step in words.
 */
export const StepDots: React.FC<StepDotsProps> = ({ index, count, from = index }) => {
  const { t } = useStrings();
  const reduceMotion = useReducedMotion();
  const widths = useRef(
    Array.from({ length: count }, (_, i) => new Animated.Value(i === from ? DOT_ACTIVE : DOT)),
  ).current;

  useEffect(() => {
    const anims = widths.map((w, i) => {
      const to = i === index ? DOT_ACTIVE : DOT;
      if (reduceMotion) {
        w.setValue(to);
        return null;
      }
      // Width is a layout prop, so no native driver; it's four small views.
      return Animated.timing(w, { toValue: to, duration: Duration.base, easing: Ease.standard, useNativeDriver: false });
    });
    const running = anims.filter((a): a is Animated.CompositeAnimation => a !== null);
    running.forEach(a => a.start());
    return () => running.forEach(a => a.stop());
  }, [index, reduceMotion, widths]);

  return (
    <View
      style={styles.dots}
      accessible
      accessibilityLabel={t('onboarding.step', { i: index + 1, n: count })}
      testID="step-dots"
    >
      {widths.map((width, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { width, backgroundColor: i === index ? Colors.primary : Colors.lineMedium }]}
        />
      ))}
    </View>
  );
};

export interface StepFrameProps {
  /** The row above the content: a back arrow or the language switch. */
  top?: React.ReactNode;
  /** Scrolls when the phone's text is large or the screen is short. */
  children: React.ReactNode;
  dots: StepDotsProps;
  /** The buttons at the bottom, main action first. */
  actions: React.ReactNode;
  /** -1 when going back, so the step slides in from the left. */
  direction?: 1 | -1;
  testID?: string;
}

/**
 * The frame every first-run step shares: top row, scrolling content, and the
 * dots and buttons pinned to the bottom. The whole step fades and slides in
 * from the side it comes from; with Reduce Motion it just appears.
 */
export const StepFrame: React.FC<StepFrameProps> = ({ top, children, dots, actions, direction = 1, testID }) => {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: Duration.slow,
      easing: Ease.standard,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, reduceMotion]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [28 * direction, 0] });

  return (
    <Animated.View style={[styles.root, { opacity: progress, transform: [{ translateX }] }]} testID={testID}>
      <View style={styles.top}>{top}</View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {children}
      </ScrollView>
      <View style={styles.footer}>
        <StepDots key={dots.count} {...dots} />
        <View style={styles.actions}>{actions}</View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: {
    minHeight: 56,
    paddingHorizontal: GUTTER - Space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: GUTTER + Space.xs, paddingBottom: Space.xl, gap: Space.xl },
  footer: { paddingHorizontal: GUTTER + Space.xs, paddingTop: Space.sm, paddingBottom: Space.xxl, gap: Space.lg },
  actions: { gap: Space.sm },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Space.sm, paddingVertical: Space.xs },
  dot: { height: DOT, borderRadius: Radius.pill },
});
