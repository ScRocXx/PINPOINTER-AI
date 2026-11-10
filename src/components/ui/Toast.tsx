import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Duration, Ease, Elevation, GUTTER, Layout, Radius, Space } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { IconName } from './iconPaths';

export interface ToastOptions {
  icon?: IconName;
  /** How long it stays, in ms. Default 2600. */
  duration?: number;
}

export interface ToastApi {
  /** Show a short confirmation ("Text copied"). TalkBack reads it aloud. */
  show: (message: string, options?: ToastOptions) => void;
}

/** Without a provider, toasts are still read aloud. */
const FALLBACK: ToastApi = {
  show: message => AccessibilityInfo.announceForAccessibility(message),
};

const ToastCtx = createContext<ToastApi>(FALLBACK);

interface ToastState {
  id: number;
  message: string;
  icon: IconName;
  duration: number;
}

/**
 * Hosts one toast at a time, just above the tab bar. A new toast replaces
 * the old one. Wrap the app once, inside SafeAreaProvider.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode; bottomOffset?: number }> = ({
  children,
  bottomOffset = Layout.tabBarHeight,
}) => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);

  const show = useCallback((message: string, options?: ToastOptions) => {
    counter.current += 1;
    setToast({ id: counter.current, message, icon: options?.icon ?? 'check', duration: options?.duration ?? 2600 });
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const api = useMemo(() => ({ show }), [show]);
  const onDone = useCallback((id: number) => setToast(cur => (cur?.id === id ? null : cur)), []);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} bottomOffset={bottomOffset} onDone={onDone} /> : null}
    </ToastCtx.Provider>
  );
};

const ToastView: React.FC<{ toast: ToastState; bottomOffset: number; onDone: (id: number) => void }> = ({
  toast,
  bottomOffset,
  onDone,
}) => {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    const d = reduceMotion ? 0 : 1;
    const anim = Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: Duration.quick * d, easing: Ease.standard, useNativeDriver: true }),
      Animated.delay(toast.duration),
      Animated.timing(progress, { toValue: 0, duration: Duration.quick * d, easing: Ease.exit, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => {
      if (finished) {
        onDone(toast.id);
      }
    });
    return () => anim.stop();
  }, [onDone, progress, reduceMotion, toast]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  return (
    <View pointerEvents="none" style={[styles.host, { bottom: bottomOffset + insets.bottom + Space.md }]}>
      <Animated.View
        style={[styles.toast, { opacity: progress, transform: [{ translateY }] }]}
        accessibilityLiveRegion="polite"
        testID="toast"
      >
        <Icon name={toast.icon} size={22} color={Colors.onNight} strokeWidth={2.25} />
        <AppText variant="bodyStrong" color="onNight" style={styles.text}>
          {toast.message}
        </AppText>
      </Animated.View>
    </View>
  );
};

export const useToast = (): ToastApi => useContext(ToastCtx);

const styles = StyleSheet.create({
  host: { position: 'absolute', left: GUTTER, right: GUTTER, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: Colors.night,
    borderRadius: Radius.pill,
    paddingVertical: Space.md,
    paddingHorizontal: Space.xl,
    maxWidth: 520,
    ...Elevation.raised,
  },
  text: { flexShrink: 1 },
});
