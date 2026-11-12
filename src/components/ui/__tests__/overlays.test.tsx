import React from 'react';
import { AccessibilityInfo, Keyboard, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Sheet, SheetAction } from '../Sheet';
import { ToastProvider, useToast } from '../Toast';
import { TabBar } from '../TabBar';
import { Screen } from '../Screen';

jest.mock('react-native-svg', () => require('./svgMock').default);

const ITEMS = [
  { key: 'home', label: 'Home', icon: 'home' as const },
  { key: 'photos', label: 'Photos', icon: 'photos' as const },
  { key: 'papers', label: 'Papers', icon: 'papers' as const },
  { key: 'settings', label: 'Settings', icon: 'settings' as const },
];

describe('Sheet', () => {
  it('opens with its actions and closes from the backdrop', async () => {
    const onClose = jest.fn();
    const onShare = jest.fn();
    await render(
      <Sheet visible onClose={onClose} title="Photo">
        <SheetAction icon="share" label="Share" onPress={onShare} hint="Send to WhatsApp" />
        <SheetAction icon="star" label="Remove from important" filled onPress={jest.fn()} />
        <SheetAction icon="trash" label="Remove" danger onPress={jest.fn()} />
      </Sheet>,
    );
    expect(screen.getByRole('header', { name: 'Photo' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Share, Send to WhatsApp' }));
    expect(onShare).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('sheet-scrim'));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays out of the tree while closed and unmounts after closing', async () => {
    jest.useFakeTimers();
    const { rerender } = await render(
      <Sheet visible={false} onClose={jest.fn()}>
        <Text>body</Text>
      </Sheet>,
    );
    expect(screen.queryByText('body')).toBeNull();
    await rerender(
      <Sheet visible onClose={jest.fn()}>
        <Text>body</Text>
      </Sheet>,
    );
    expect(screen.getByText('body')).toBeTruthy();
    await rerender(
      <Sheet visible={false} onClose={jest.fn()}>
        <Text>body</Text>
      </Sheet>,
    );
    await act(async () => {
      jest.runAllTimers();
    });
    expect(screen.queryByText('body')).toBeNull();
    jest.useRealTimers();
  });
});

describe('Toast', () => {
  const Trigger: React.FC<{ message: string }> = ({ message }) => {
    const toast = useToast();
    return <Text onPress={() => toast.show(message, { icon: 'copy', duration: 100 })}>go</Text>;
  };

  it('shows, announces and then hides', async () => {
    jest.useFakeTimers();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    await render(
      <ToastProvider>
        <Trigger message="Text copied" />
      </ToastProvider>,
    );
    await fireEvent.press(screen.getByText('go'));
    expect(screen.getByText('Text copied')).toBeTruthy();
    expect(announce).toHaveBeenCalledWith('Text copied');
    await act(async () => {
      jest.runAllTimers();
    });
    expect(screen.queryByText('Text copied')).toBeNull();
    announce.mockRestore();
    jest.useRealTimers();
  });

  it('still announces without a provider', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    await render(<Trigger message="Saved" />);
    await fireEvent.press(screen.getByText('go'));
    expect(announce).toHaveBeenCalledWith('Saved');
    announce.mockRestore();
  });
});

describe('TabBar', () => {
  it('puts the mic in the middle and marks the active tab', async () => {
    const onSelect = jest.fn();
    const onMic = jest.fn();
    await render(
      <TabBar items={ITEMS} activeKey="photos" onSelect={onSelect} actionLabel="Speak" actionAccessibilityLabel="Search by voice" onAction={onMic} bottomInset={24} />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.props.accessibilityLabel)).toEqual(['Home', 'Photos', 'Papers', 'Settings']);
    expect(screen.getByRole('tab', { name: 'Photos' }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('tab', { name: 'Papers' }));
    expect(onSelect).toHaveBeenCalledWith('papers');
    await fireEvent.press(screen.getByRole('button', { name: 'Search by voice' }));
    expect(onMic).toHaveBeenCalled();
    expect(screen.getByText('Speak')).toBeTruthy();
  });

  it('places the beam mark after layout', async () => {
    await render(<TabBar items={ITEMS} activeKey="home" onSelect={jest.fn()} actionLabel="Speak" onAction={jest.fn()} />);
    expect(screen.queryByTestId('tab-bar-indicator')).toBeNull();
    await fireEvent(screen.getByTestId('tab-bar'), 'layout', { nativeEvent: { layout: { width: 400, height: 72 } } });
    expect(screen.getByTestId('tab-bar-indicator')).toBeTruthy();
  });

  it('hides while the keyboard is open', async () => {
    const listeners: Record<string, () => void> = {};
    const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: () => void) => {
      listeners[event] = fn;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    await render(<TabBar items={ITEMS} activeKey="home" onSelect={jest.fn()} actionLabel="Speak" onAction={jest.fn()} />);
    await act(async () => listeners.keyboardDidShow());
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    await act(async () => listeners.keyboardDidHide());
    expect(screen.getByTestId('tab-bar')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('Screen', () => {
  it('paints the tone and holds its children', async () => {
    await render(
      <Screen tone="night" padBottom testID="s">
        <Text>viewer</Text>
      </Screen>,
    );
    expect(screen.getByTestId('s')).toHaveStyle({ backgroundColor: '#0E0C14' });
    expect(screen.getByText('viewer')).toBeTruthy();
  });

  it('draws the soft wash only when asked, and never on the night stage', async () => {
    await render(
      <Screen wash testID="lit">
        <Text>photos</Text>
      </Screen>,
    );
    expect(screen.getByTestId('lit-wash')).toBeTruthy();
    await render(
      <Screen testID="plain">
        <Text>plain</Text>
      </Screen>,
    );
    expect(screen.queryByTestId('plain-wash')).toBeNull();
    await render(
      <Screen wash tone="night" testID="dark">
        <Text>viewer</Text>
      </Screen>,
    );
    expect(screen.queryByTestId('dark-wash')).toBeNull();
  });
});
