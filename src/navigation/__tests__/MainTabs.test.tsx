import React, { useEffect } from 'react';
import { BackHandler, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  createNavigatorFactory,
  NavigationContainer,
  StackRouter,
  useNavigation,
  useNavigationBuilder,
} from '@react-navigation/native';
import { createMainTabNavigator, MainTabNavigationProp } from '../MainTabs';
import { LanguageProvider } from '../../i18n';
import { useScreenFocus } from '../../hooks/useScreenFocus';

jest.mock('react-native-svg', () => require('../../components/ui/__tests__/svgMock').default);

type Tabs = { Pinpointer: undefined; Gallery: undefined; DocumentVault: undefined; Settings: undefined };
const Tab = createMainTabNavigator<Tabs>();
/**
 * A bare stack that shows only the top screen. The real stack needs the
 * gesture handler, which the repo's mock doesn't fully provide.
 */
const BareStack = createNavigatorFactory(({ children, initialRouteName }: { children: React.ReactNode; initialRouteName?: string }) => {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, { children, initialRouteName });
  return <NavigationContent>{descriptors[state.routes[state.index].key].render()}</NavigationContent>;
});
const Stack = BareStack();

const mounts: Record<string, number> = {};

const Page: React.FC<{ name: string; hideBar?: boolean }> = ({ name, hideBar }) => {
  const navigation = useNavigation<MainTabNavigationProp<Tabs>>();
  const focused = useScreenFocus();
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
  }, [name]);
  return (
    <>
      <Text>{`${name} page ${focused ? 'focused' : 'hidden'}`}</Text>
      {hideBar ? (
        <Text onPress={() => navigation.setOptions({ tabBarHidden: true })}>{`hide bar ${name}`}</Text>
      ) : null}
      <Text onPress={() => navigation.navigate('Gallery')}>{`go gallery from ${name}`}</Text>
    </>
  );
};

const Home = () => <Page name="home" hideBar />;
const Photos = () => <Page name="photos" />;
const Papers = () => <Page name="papers" />;
const Settings = () => <Page name="settings" />;
const Scan = () => <Text>scan page</Text>;

const MainTabs = () => (
  <Tab.Navigator onScanPress={navigation => navigation.navigate('SmartClipboard')}>
    <Tab.Screen name="Pinpointer" component={Home} options={{ tabLabelKey: 'tab.home', tabIcon: 'home' }} />
    <Tab.Screen name="Gallery" component={Photos} options={{ tabLabelKey: 'tab.photos', tabIcon: 'photos' }} />
    <Tab.Screen name="DocumentVault" component={Papers} options={{ tabLabelKey: 'tab.papers', tabIcon: 'papers' }} />
    <Tab.Screen name="Settings" component={Settings} />
  </Tab.Navigator>
);

const renderApp = (lang: 'en' | 'hi' = 'en') =>
  render(
    <LanguageProvider initialLanguage={lang}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="SmartClipboard" component={Scan} />
        </Stack.Navigator>
      </NavigationContainer>
    </LanguageProvider>,
  );

beforeEach(() => Object.keys(mounts).forEach(k => delete mounts[k]));

describe('MainTabs', () => {
  it('opens on the first tab and mounts only it', async () => {
    await renderApp();
    expect(screen.getByText('home page focused')).toBeTruthy();
    expect(screen.queryByText(/photos page/)).toBeNull();
    expect(screen.getByRole('tab', { name: 'Home' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('labels tabs from the strings list, falling back to the route name', async () => {
    await renderApp('hi');
    const labels = screen.getAllByRole('tab').map(t => t.props.accessibilityLabel);
    expect(labels).toHaveLength(4);
    expect(labels[0]).not.toBe('Home');
    expect(labels[3]).toBe('Settings');
  });

  it('switches tabs and keeps visited tabs mounted', async () => {
    await renderApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Photos' }));
    expect(screen.getByText('photos page focused')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Photos' }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('tab', { name: 'Home' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Photos' }));
    expect(mounts.photos).toBe(1);
    expect(mounts.home).toBe(1);
    expect(screen.getByText('home page hidden', { includeHiddenElements: true })).toBeTruthy();
  });

  it('tapping the open tab does nothing', async () => {
    await renderApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Home' }));
    expect(screen.getByText('home page focused')).toBeTruthy();
  });

  it('navigates between tabs by route name', async () => {
    await renderApp();
    await fireEvent.press(screen.getByText('go gallery from home'));
    expect(screen.getByText('photos page focused')).toBeTruthy();
  });

  it('the Scan button opens the scan screen on the stack', async () => {
    await renderApp();
    await fireEvent.press(screen.getByTestId('tab-bar-scan'));
    expect(await screen.findByText('scan page')).toBeTruthy();
  });

  it('a screen can hide the bar', async () => {
    await renderApp();
    await fireEvent.press(screen.getByText('hide bar home'));
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    await fireEvent.press(screen.getByText('go gallery from home'));
    expect(screen.getByTestId('tab-bar')).toBeTruthy();
  });

  it('Android back returns to the first tab', async () => {
    const handlers: Array<() => boolean> = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, fn: () => boolean) => {
      handlers.push(fn);
      return { remove: jest.fn() };
    }) as unknown as typeof BackHandler.addEventListener);
    await renderApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Papers' }));
    expect(screen.getByText('papers page focused')).toBeTruthy();
    await act(async () => {
      handlers.forEach(h => h());
    });
    expect(screen.getByText('home page focused')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('useScreenFocus', () => {
  it('is true outside a navigator', async () => {
    const Probe = () => <Text>{useScreenFocus() ? 'yes' : 'no'}</Text>;
    await render(<Probe />);
    expect(screen.getByText('yes')).toBeTruthy();
  });
});
