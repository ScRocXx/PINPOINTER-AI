import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppText } from '../AppText';
import { Icon } from '../Icon';
import { ICON_PATHS } from '../iconPaths';
import { PinMark } from '../PinMark';
import { PressableScale } from '../PressableScale';
import { BeamGradient, BeamRing } from '../Beam';
import { LockOnCorners } from '../LockOnCorners';
import { Colors, MAX_FONT_SCALE, Type } from '../../../theme';

jest.mock('react-native-svg', () => require('./svgMock').default);

describe('AppText', () => {
  it('applies the type style and a semantic colour', async () => {
    await render(
      <AppText variant="title" color="primary">
        Hello
      </AppText>,
    );
    const el = screen.getByText('Hello');
    expect(el).toHaveStyle({ fontSize: Type.title.fontSize, color: Colors.primary });
    expect(el.props.maxFontSizeMultiplier).toBe(MAX_FONT_SCALE);
  });

  it('accepts raw colours and alignment', async () => {
    await render(
      <AppText color="#123456" align="center">
        Raw
      </AppText>,
    );
    expect(screen.getByText('Raw')).toHaveStyle({ color: '#123456', textAlign: 'center', fontSize: 18 });
  });
});

describe('Icon', () => {
  it('has a path for every name', () => {
    Object.values(ICON_PATHS).forEach(d => expect(d.length).toBeGreaterThan(4));
  });

  it('is silent by default', async () => {
    await render(<Icon name="search" />);
    const el = screen.getByTestId('icon-search', { includeHiddenElements: true });
    expect(el.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(el.props.accessible).toBe(false);
  });

  it('speaks when it stands alone', async () => {
    await render(<Icon name="star" filled accessibilityLabel="Important" testID="star" />);
    expect(screen.getByLabelText('Important')).toBeTruthy();
  });
});

describe('PinMark', () => {
  it('renders the mark, decorative unless labelled', async () => {
    await render(<PinMark />);
    expect(screen.getByTestId('pin-mark', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
    await render(<PinMark accessibilityLabel="Pinpointer" />);
    expect(screen.getByLabelText('Pinpointer')).toBeTruthy();
  });
});

describe('PressableScale', () => {
  it('passes presses through and merges the disabled state', async () => {
    const onPress = jest.fn();
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    await render(
      <PressableScale
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel="Go"
        accessibilityState={{ selected: true }}
      >
        <Text>Go</Text>
      </PressableScale>,
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    await fireEvent(btn, 'pressIn');
    await fireEvent(btn, 'pressOut');
    await fireEvent.press(btn);
    expect(onPressIn).toHaveBeenCalled();
    expect(onPressOut).toHaveBeenCalled();
    expect(onPress).toHaveBeenCalled();
    expect(btn.props.accessibilityState).toEqual({ disabled: false, selected: true });
  });

  it('does nothing while disabled', async () => {
    const onPress = jest.fn();
    await render(
      <PressableScale onPress={onPress} disabled accessibilityRole="button" accessibilityLabel="No">
        <Text>No</Text>
      </PressableScale>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'No' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
  });
});

describe('Beam', () => {
  it('fills with the beam colours', async () => {
    await render(<BeamGradient testID="fill" />);
    expect(screen.getByTestId('fill').props.colors).toHaveLength(3);
  });

  it('runs horizontally when asked', async () => {
    await render(<BeamGradient horizontal testID="h" />);
    expect(screen.getByTestId('h').props.start).toEqual({ x: 0, y: 0.5 });
  });

  it('puts a ring around its child', async () => {
    const { rerender } = await render(
      <BeamRing active={false} radius={16} testID="field">
        <Text>child</Text>
      </BeamRing>,
    );
    expect(screen.getByTestId('field-ring')).toBeTruthy();
    expect(screen.getByText('child')).toBeTruthy();
    await rerender(
      <BeamRing active radius={16} testID="field">
        <Text>child</Text>
      </BeamRing>,
    );
    expect(screen.getByTestId('field-ring')).toBeTruthy();
  });
});

describe('LockOnCorners', () => {
  it('renders four corners and never takes touches', async () => {
    await render(<LockOnCorners searching />);
    const el = screen.getByTestId('lock-on-corners');
    expect(el.props.pointerEvents).toBe('none');
    expect(el.children).toHaveLength(4);
  });

  it('uses one colour when given', async () => {
    await render(<LockOnCorners active={false} color="#ff0000" testID="lc" />);
    expect(screen.getByTestId('lc')).toBeTruthy();
  });
});
