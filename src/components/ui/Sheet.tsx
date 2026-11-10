import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Duration, Ease, Elevation, GUTTER, Radius, Space, Touch } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useStrings } from '../../i18n';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { IconName } from './iconPaths';
import { PressableScale } from './PressableScale';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Spoken label of the dim area behind the sheet. Default "Close". */
  closeLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A bottom sheet over a dim backdrop. Back button and a tap outside close
 * it. It slides up on open and down on close (instant with Reduce Motion).
 */
export const Sheet: React.FC<SheetProps> = ({ visible, onClose, title, children, closeLabel, style, testID = 'sheet' }) => {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { t } = useStrings();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
    if (reduceMotion) {
      progress.setValue(visible ? 1 : 0);
      if (!visible) {
        setMounted(false);
      }
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? Duration.base : Duration.quick,
      easing: visible ? Ease.standard : Ease.exit,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
    return () => anim.stop();
  }, [progress, reduceMotion, visible]);

  if (!mounted) {
    return null;
  }

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });

  return (
    <Modal transparent visible onRequestClose={onClose} statusBarTranslucent animationType="none" testID={testID}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel ?? t('common.close')}
          testID={`${testID}-scrim`}
        />
      </Animated.View>
      <View style={styles.bottom} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.panel,
            { paddingBottom: Space.lg + insets.bottom, transform: [{ translateY }] },
            style,
          ]}
          accessibilityViewIsModal
          testID={`${testID}-panel`}
        >
          <View style={styles.handle} />
          {title ? (
            <AppText variant="heading" accessibilityRole="header" style={styles.title}>
              {title}
            </AppText>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
};

export interface SheetActionProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** A second line ("Copies the words, not the photo"). */
  hint?: string;
  /** Show the icon filled (a filled star for "Remove from important"). */
  filled?: boolean;
  danger?: boolean;
  testID?: string;
}

/** One big action row inside a Sheet (Share, Copy text, Important...). */
export const SheetAction: React.FC<SheetActionProps> = ({ icon, label, onPress, hint, filled, danger, testID }) => {
  const color = danger ? Colors.danger : Colors.text;
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.985}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      style={styles.action}
      testID={testID}
    >
      <View style={styles.actionIcon}>
        <Icon
          name={icon}
          size={24}
          color={color}
          strokeWidth={2}
          filled={filled}
          fillColor={icon === 'star' ? Colors.importantStar : undefined}
        />
      </View>
      <View style={styles.actionText}>
        <AppText variant="bodyStrong" color={danger ? 'danger' : 'text'}>
          {label}
        </AppText>
        {hint ? (
          <AppText variant="small" color="textSecondary">
            {hint}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  scrim: { backgroundColor: Colors.scrim },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: GUTTER,
    paddingTop: Space.sm,
    ...Elevation.raised,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.lineStrong,
    marginBottom: Space.md,
  },
  title: { marginBottom: Space.sm },
  action: {
    minHeight: Touch.comfortable + Space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
    paddingVertical: Space.sm,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { flex: 1 },
});
