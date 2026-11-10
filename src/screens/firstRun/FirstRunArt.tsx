/**
 * The pictures at the top of the first-run steps, drawn with views so they
 * cost no image files. The person's photos are the colour of the app, so
 * these are drawn stand-ins: an ID card, a bill, a family photo, a medicine
 * strip, PDFs. Each enters once (pins drop, cards float in, the lock-on
 * corners close on what Pinpointer finds) and then stays still. Reduce
 * Motion shows the end state straight away.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { LockOnCorners, PinMark, Reveal } from '../../components/ui';
import { Art, Colors, Duration, Ease, GUTTER, Radius, Space } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** The receipt's torn bottom edge, drawn in a 76 x 98 box. */
const RECEIPT = 'M0 0H76V90L66.5 98L57 90L47.5 98L38 90L28.5 98L19 90L9.5 98L0 90Z';

/** 0 → 1 once, after `delay`; 1 straight away with Reduce Motion. */
const useEntrance = (delay: number, spring = false): Animated.Value => {
  const reduceMotion = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      value.setValue(1);
      return;
    }
    const anim = spring
      ? Animated.spring(value, { toValue: 1, delay, damping: 9, stiffness: 150, mass: 1, useNativeDriver: true })
      : Animated.timing(value, { toValue: 1, delay, duration: Duration.slow, easing: Ease.standard, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [delay, reduceMotion, spring, value]);
  return value;
};

/** A card that floats up into place at a slight tilt. */
const FloatIn: React.FC<{ delay: number; rotate: string; style: StyleProp<ViewStyle>; children?: React.ReactNode }> = ({
  delay,
  rotate,
  style,
  children,
}) => {
  const p = useEntrance(delay);
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return <Animated.View style={[style, { opacity: p, transform: [{ translateY }, { rotate }] }]}>{children}</Animated.View>;
};

/** Grey bars standing in for lines of text. */
const Lines: React.FC<{ widths: Array<number | `${number}%`>; height?: number; color?: string }> = ({
  widths,
  height = 5,
  color = Colors.lineMedium,
}) => (
  <>
    {widths.map((width, i) => (
      <View key={i} style={[styles.line, { width, height, backgroundColor: color }]} />
    ))}
  </>
);

/** Fits a fixed-size drawing into the screen width (small phones scale it down). */
const Fit: React.FC<{ width: number; height: number; children: React.ReactNode; testID?: string }> = ({
  width,
  height,
  children,
  testID,
}) => {
  const window = useWindowDimensions();
  const room = Math.max(0, (window.width || width) - 2 * (GUTTER + Space.xs));
  const scale = Math.min(1, room / width);
  return (
    <View
      style={[styles.fitBox, { width: width * scale, height: height * scale }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={testID}
    >
      <View style={[styles.fitInner, { width, height, transform: [{ scale }] }]}>{children}</View>
    </View>
  );
};

const WELCOME_W = 320;
const WELCOME_H = 300;

/** Step 1: the mark drops in among the things people look for. */
export const WelcomeArt: React.FC = () => {
  const drop = useEntrance(100, true);
  const pinY = drop.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] });
  const pinOpacity = drop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });

  return (
    <Fit width={WELCOME_W} height={WELCOME_H} testID="welcome-art">
      <View style={styles.halo} />

      {/* The ID card, which the corners lock on to */}
      <FloatIn delay={500} rotate="-8deg" style={styles.idCard}>
        <LinearGradient colors={[...Art.flag]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.idStripe} />
        <View style={styles.idBody}>
          <View style={styles.idPhoto} />
          <View style={styles.idLines}>
            <Lines widths={['100%', '70%', '85%']} />
          </View>
        </View>
      </FloatIn>
      <View style={styles.idLock}>
        <LockOnCorners delay={1000} inset={0} />
      </View>

      {/* A bill */}
      <FloatIn delay={600} rotate="7deg" style={styles.receipt}>
        <Svg width={76} height={98} style={StyleSheet.absoluteFill}>
          <Path d={RECEIPT} fill={Colors.surface} />
        </Svg>
        <View style={styles.receiptLines}>
          <Lines widths={['60%']} height={6} color={Colors.primary} />
          <Lines widths={['100%', '100%', '75%']} />
          <View style={styles.receiptTotal} />
        </View>
      </FloatIn>

      {/* A family photo */}
      <FloatIn delay={700} rotate="-4deg" style={styles.family}>
        <LinearGradient colors={[...Art.warm]} locations={[0, 0.7, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.person, styles.personA]} />
        <View style={[styles.head, styles.headA]} />
        <View style={[styles.person, styles.personB]} />
        <View style={[styles.head, styles.headB]} />
      </FloatIn>

      {/* A medicine strip */}
      <FloatIn delay={800} rotate="5deg" style={styles.strip}>
        <LinearGradient colors={[...Art.strip]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={styles.pills}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={[styles.pill, i === 3 ? styles.pillUsed : null]} />
          ))}
        </View>
      </FloatIn>

      {/* The mark, dropping in last-but-first */}
      <Animated.View style={[styles.pins, { opacity: pinOpacity, transform: [{ translateY: pinY }] }]}>
        <PinMark size={128} background={Colors.sunken} />
      </Animated.View>
    </Fit>
  );
};

const PHOTO_TILES: Array<{ colors: readonly string[]; locations?: number[]; diagonal?: boolean }> = [
  { colors: Art.sky, locations: [0, 0.48, 0.49, 1], diagonal: true },
  { colors: Art.sunset, locations: [0, 0.6, 1] },
  { colors: [] }, // a screenshot
  { colors: Art.dusk, locations: [0, 0.5, 1], diagonal: true },
  { colors: [] }, // the bill Pinpointer finds
  { colors: Art.shore, locations: [0, 0.58, 0.59, 1] },
];

/** Step 2: a few of "your photos", and the corners find the bill among them. */
export const PhotosArt: React.FC = () => (
  <Fit width={300} height={192} testID="photos-art">
    <View style={styles.grid}>
      {PHOTO_TILES.map((tile, i) => (
        <Reveal key={i} index={i} style={styles.tileCell}>
          {i === 2 ? (
            <View style={[styles.tile, styles.tileFlat]}>
              <View style={styles.phone} />
            </View>
          ) : i === 4 ? (
            <View style={[styles.tile, styles.tileFound]}>
              <View style={styles.miniReceipt}>
                <Svg width={48} height={64} viewBox="0 0 76 98" style={StyleSheet.absoluteFill}>
                  <Path d={RECEIPT} fill={Colors.surface} />
                </Svg>
                <View style={styles.miniReceiptLines}>
                  <Lines widths={['60%']} height={5} color={Colors.primary} />
                  <Lines widths={['100%', '100%']} height={4} />
                  <View style={styles.miniTotal} />
                </View>
              </View>
              <LockOnCorners delay={400} />
            </View>
          ) : (
            <LinearGradient
              colors={[...tile.colors]}
              locations={tile.locations}
              start={{ x: 0, y: 0 }}
              end={tile.diagonal ? { x: 1, y: 1 } : { x: 0, y: 1 }}
              style={styles.tile}
            />
          )}
        </Reveal>
      ))}
    </View>
  </Fit>
);

/** Step 3: PDFs fan out of the phone's folders; the corners find one. */
export const PapersArt: React.FC = () => (
  <Fit width={300} height={200} testID="papers-art">
    <View style={styles.papersHalo} />
    {[
      { rotate: '-12deg', left: 46, top: 40, delay: 0 },
      { rotate: '10deg', left: 158, top: 38, delay: 1 },
    ].map(paper => (
      <Reveal key={paper.rotate} index={paper.delay} style={[styles.paper, { left: paper.left, top: paper.top }]}>
        <View style={[styles.paperFace, { transform: [{ rotate: paper.rotate }] }]}>
          <Lines widths={['55%', '100%', '100%', '80%', '100%', '65%']} height={5} />
        </View>
      </Reveal>
    ))}
    <Reveal index={2} style={[styles.paper, styles.paperFront]}>
      <View style={styles.paperFace}>
        <View style={styles.paperFold} />
        <Lines widths={['60%']} height={7} color={Colors.primary} />
        <Lines widths={['100%', '100%', '85%', '100%', '70%']} height={5} />
        <View style={styles.paperTotal} />
      </View>
      <LockOnCorners delay={500} />
    </Reveal>
  </Fit>
);

const CARD_SHADOW: ViewStyle = { boxShadow: '0px 8px 20px rgba(54, 38, 140, 0.14)' };

const styles = StyleSheet.create({
  fitBox: { alignSelf: 'center', overflow: 'visible' },
  fitInner: { transformOrigin: 'top left' },
  line: { borderRadius: 3 },

  // Welcome
  halo: {
    position: 'absolute',
    top: 40,
    left: 50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: Colors.sunken,
  },
  pins: { position: 'absolute', top: 76, left: 96 },
  idCard: {
    position: 'absolute',
    top: 18,
    left: 8,
    width: 112,
    height: 72,
    borderRadius: Radius.xs,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  idStripe: { height: 10 },
  idBody: { flexDirection: 'row', gap: 7, padding: Space.sm },
  idPhoto: { width: 24, height: 32, borderRadius: 3, backgroundColor: Colors.line },
  idLines: { flex: 1, gap: 5 },
  idLock: { position: 'absolute', top: 6, left: 0, width: 128, height: 96 },
  receipt: { position: 'absolute', top: 112, left: 236, width: 76, height: 98 },
  receiptLines: { paddingVertical: 11, paddingHorizontal: 9, gap: 6 },
  receiptTotal: { width: '55%', height: 8, borderRadius: 3, backgroundColor: Colors.text, alignSelf: 'flex-end' },
  family: {
    position: 'absolute',
    top: 204,
    left: 30,
    width: 104,
    height: 78,
    borderRadius: Radius.sm - 4,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  person: { position: 'absolute', bottom: -14, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderRadius: 6 },
  personA: { left: 18, width: 30, height: 44, backgroundColor: Art.people[0] },
  personB: { left: 52, width: 34, height: 52, backgroundColor: Art.people[2] },
  head: { position: 'absolute', borderRadius: Radius.pill },
  headA: { bottom: 24, left: 24, width: 18, height: 18, backgroundColor: Art.people[1] },
  headB: { bottom: 32, left: 59, width: 20, height: 20, backgroundColor: Art.people[3] },
  strip: {
    position: 'absolute',
    top: 200,
    left: 232,
    width: 54,
    height: 64,
    borderRadius: Radius.xs,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  pills: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5, padding: Space.sm },
  pill: { width: 15, height: 20, borderRadius: Radius.pill, backgroundColor: Colors.surface },
  pillUsed: { backgroundColor: Colors.lineMedium },

  // Photos
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, paddingHorizontal: Space.xl },
  tileCell: { width: (300 - 2 * Space.xl - 2 * Space.sm) / 3 },
  tile: { height: 92, borderRadius: Radius.sm - 2, overflow: 'hidden' },
  tileFlat: { backgroundColor: Colors.sunken, alignItems: 'center', justifyContent: 'center' },
  tileFound: { backgroundColor: Colors.primarySoft, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  phone: {
    width: 40,
    height: 72,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.text,
    backgroundColor: Colors.surface,
  },
  miniReceipt: { width: 48, height: 64 },
  miniReceiptLines: { paddingVertical: 7, paddingHorizontal: 6, gap: 4 },
  miniTotal: { width: '55%', height: 6, borderRadius: 3, backgroundColor: Colors.text, alignSelf: 'flex-end' },

  // Papers
  papersHalo: {
    position: 'absolute',
    top: 0,
    left: 60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: Colors.sunken,
  },
  paper: { position: 'absolute', width: 96, height: 124 },
  paperFront: { left: 102, top: 52 },
  paperFace: {
    flex: 1,
    borderRadius: Radius.xs - 2,
    backgroundColor: Colors.surface,
    padding: Space.md,
    gap: 7,
    ...CARD_SHADOW,
  },
  paperFold: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 18,
    height: 18,
    borderBottomLeftRadius: 6,
    backgroundColor: Colors.sunken,
  },
  paperTotal: { width: '45%', height: 7, borderRadius: 3, backgroundColor: Colors.text, alignSelf: 'flex-end', marginTop: 2 },
});
