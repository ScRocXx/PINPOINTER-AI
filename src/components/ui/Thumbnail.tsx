import React, { useEffect, useRef, useState } from 'react';
import { Animated, ImageResizeMode, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Duration, Ease, Radius } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Icon } from './Icon';
import { IconName } from './iconPaths';

export interface ThumbnailProps {
  uri?: string | null;
  size?: number;
  /** Width / height. Default 1 (square). */
  aspectRatio?: number;
  radius?: number;
  resizeMode?: ImageResizeMode;
  /** Shown while loading and when there's no picture (PDFs, missing files). */
  fallbackIcon?: IconName;
  /** Fill the parent's width instead of a fixed size (grids). */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A photo that fades in once decoded, over a soft placeholder, so grids never
 * flash white. Thumbnails ask Android for a small decode (`resizeMethod`)
 * to save memory on 2 GB phones.
 */
export const Thumbnail: React.FC<ThumbnailProps> = ({
  uri,
  size = 112,
  aspectRatio = 1,
  radius = Radius.sm,
  resizeMode = 'cover',
  fallbackIcon = 'photos',
  fill = false,
  style,
  testID = 'thumbnail',
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const showImage = !!uri && !failed;

  // A recycled grid cell gets a new uri: start the fade again.
  useEffect(() => {
    opacity.setValue(0);
    setFailed(false);
  }, [opacity, uri]);

  const onLoad = () => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: Duration.quick, easing: Ease.standard, useNativeDriver: true }).start();
  };

  const box: ViewStyle = fill ? { width: '100%', aspectRatio } : { width: size, height: size / aspectRatio };

  return (
    <View style={[styles.box, box, { borderRadius: radius }, style]} testID={testID}>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Icon name={fallbackIcon} size={Math.min(32, Math.round(size / 3))} color={Colors.textMuted} />
      </View>
      {showImage ? (
        <Animated.Image
          source={{ uri }}
          resizeMode={resizeMode}
          resizeMethod="resize"
          onLoad={onLoad}
          onError={() => setFailed(true)}
          style={[StyleSheet.absoluteFill, { opacity }]}
          testID={`${testID}-image`}
          accessible={false}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: { backgroundColor: Colors.sunken, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
