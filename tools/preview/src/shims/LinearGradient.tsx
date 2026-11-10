// react-native-linear-gradient for the browser: a View with a CSS gradient.
import React from 'react';
import { View, ViewProps } from 'react-native';

type Point = { x: number; y: number };
interface Props extends ViewProps {
  colors: string[];
  locations?: number[];
  start?: Point;
  end?: Point;
  children?: React.ReactNode;
}

const LinearGradient: React.FC<Props> = ({ colors, locations, start = { x: 0.5, y: 0 }, end = { x: 0.5, y: 1 }, style, children, ...rest }) => {
  const angle = (Math.atan2(end.x - start.x, -(end.y - start.y)) * 180) / Math.PI;
  const stops = colors.map((c, i) => (locations ? `${c} ${locations[i] * 100}%` : c)).join(', ');
  return (
    <View {...rest} style={[style, { backgroundImage: `linear-gradient(${angle}deg, ${stops})` } as object]}>
      {children}
    </View>
  );
};

export default LinearGradient;
export { LinearGradient };
