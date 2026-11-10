import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  CommonActions,
  createNavigatorFactory,
  DefaultNavigatorOptions,
  Descriptor,
  NavigationHelpers,
  NavigationProp,
  NavigatorTypeBagBase,
  ParamListBase,
  RouteProp,
  StaticConfig,
  TabActionHelpers,
  TabNavigationState,
  TabRouter,
  TabRouterOptions,
  TypedNavigator,
  useNavigationBuilder,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconName, TabBar } from '../components/ui';
import { StringKey, useStrings } from '../i18n';
import { Colors } from '../theme';

/**
 * Pinpointer's own bottom-tab navigator, built on React Navigation's
 * TabRouter so it needs no extra package (no @react-navigation/bottom-tabs).
 *
 * - Tabs mount the first time they're opened and then stay mounted, so a
 *   search or a scroll position survives switching tabs.
 * - A screen hides the bar with `navigation.setOptions({ tabBarHidden: true })`
 *   (the search screen does this while results are open).
 * - Android back goes to the first tab, then leaves the app.
 */
export type MainTabNavigationOptions = {
  /** Words under the tab icon, looked up in the strings list. */
  tabLabelKey?: StringKey;
  tabIcon?: IconName;
  /** Hide the bar while this screen needs the whole height. */
  tabBarHidden?: boolean;
};

export type MainTabNavigationEventMap = {
  /** Fired when a tab is tapped, even the one already open. */
  tabPress: { data: { isAlreadyFocused: boolean }; canPreventDefault: true };
};

export type MainTabNavigationProp<
  ParamList extends ParamListBase,
  RouteName extends keyof ParamList = keyof ParamList,
  NavigatorID extends string | undefined = undefined,
> = NavigationProp<
  ParamList,
  RouteName,
  NavigatorID,
  TabNavigationState<ParamList>,
  MainTabNavigationOptions,
  MainTabNavigationEventMap
> &
  TabActionHelpers<ParamList>;

type MainTabDescriptor = Descriptor<
  MainTabNavigationOptions,
  MainTabNavigationProp<ParamListBase>,
  RouteProp<ParamListBase>
>;

export type MainTabBarProps = {
  state: TabNavigationState<ParamListBase>;
  descriptors: Record<string, MainTabDescriptor>;
  navigation: NavigationHelpers<ParamListBase, MainTabNavigationEventMap>;
  /** What the middle Scan button does. */
  onScanPress: () => void;
};

export type MainTabNavigatorProps = DefaultNavigatorOptions<
  ParamListBase,
  string | undefined,
  TabNavigationState<ParamListBase>,
  MainTabNavigationOptions,
  MainTabNavigationEventMap,
  MainTabNavigationProp<ParamListBase>
> &
  TabRouterOptions & {
    /** Called with the navigator's navigation when Scan is tapped. */
    onScanPress: (navigation: NavigationHelpers<ParamListBase, MainTabNavigationEventMap>) => void;
    /** Replace the bar (tests, previews). */
    tabBar?: (props: MainTabBarProps) => React.ReactNode;
  };

/** The default bar: the shared TabBar, translated, above the gesture bar. */
export const MainTabBar: React.FC<MainTabBarProps> = ({ state, descriptors, navigation, onScanPress }) => {
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const focused = state.routes[state.index];
  if (descriptors[focused.key]?.options.tabBarHidden) {
    return null;
  }

  const items = state.routes.map(route => {
    const { options } = descriptors[route.key];
    return {
      key: route.key,
      label: options.tabLabelKey ? t(options.tabLabelKey) : route.name,
      icon: options.tabIcon ?? 'home',
    };
  });

  const onSelect = (key: string) => {
    const route = state.routes.find(r => r.key === key);
    if (!route) {
      return;
    }
    const isAlreadyFocused = route.key === focused.key;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
      data: { isAlreadyFocused },
    });
    if (!isAlreadyFocused && !event.defaultPrevented) {
      navigation.dispatch({ ...CommonActions.navigate(route), target: state.key });
    }
  };

  return (
    <TabBar
      items={items}
      activeKey={focused.key}
      onSelect={onSelect}
      scanLabel={t('tab.scan')}
      scanAccessibilityLabel={t('tab.scanLabel')}
      onScan={onScanPress}
      bottomInset={insets.bottom}
    />
  );
};

function MainTabNavigator({
  id,
  initialRouteName,
  backBehavior = 'firstRoute',
  children,
  layout,
  screenListeners,
  screenOptions,
  screenLayout,
  UNSTABLE_router,
  onScanPress,
  tabBar,
}: MainTabNavigatorProps) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder<
    TabNavigationState<ParamListBase>,
    TabRouterOptions,
    TabActionHelpers<ParamListBase>,
    MainTabNavigationOptions,
    MainTabNavigationEventMap
  >(TabRouter, {
    id,
    initialRouteName,
    backBehavior,
    children,
    layout,
    screenListeners,
    screenOptions,
    screenLayout,
    UNSTABLE_router,
  });

  // Mount a tab the first time it's opened, then keep it.
  const focusedKey = state.routes[state.index].key;
  const [loaded, setLoaded] = useState<string[]>([focusedKey]);
  if (!loaded.includes(focusedKey)) {
    setLoaded([...loaded, focusedKey]);
  }

  const barProps: MainTabBarProps = {
    state,
    descriptors: descriptors as Record<string, MainTabDescriptor>,
    navigation,
    onScanPress: () => onScanPress(navigation),
  };

  return (
    <NavigationContent>
      <View style={styles.root}>
        <View style={styles.screens}>
          {state.routes.map(route => {
            const isFocused = route.key === focusedKey;
            if (!isFocused && !loaded.includes(route.key)) {
              return null;
            }
            return (
              <View
                key={route.key}
                style={[StyleSheet.absoluteFill, isFocused ? null : styles.hidden]}
                importantForAccessibility={isFocused ? 'auto' : 'no-hide-descendants'}
                testID={`tab-screen-${route.name}`}
              >
                {descriptors[route.key].render()}
              </View>
            );
          })}
        </View>
        {tabBar ? tabBar(barProps) : <MainTabBar {...barProps} />}
      </View>
    </NavigationContent>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.canvas },
  screens: { flex: 1 },
  hidden: { display: 'none' },
});

export function createMainTabNavigator<
  const ParamList extends ParamListBase,
  const NavigatorID extends string | undefined = string | undefined,
  const TypeBag extends NavigatorTypeBagBase = {
    ParamList: ParamList;
    NavigatorID: NavigatorID;
    State: TabNavigationState<ParamList>;
    ScreenOptions: MainTabNavigationOptions;
    EventMap: MainTabNavigationEventMap;
    NavigationList: {
      [RouteName in keyof ParamList]: MainTabNavigationProp<ParamList, RouteName, NavigatorID>;
    };
    Navigator: typeof MainTabNavigator;
  },
  const Config extends StaticConfig<TypeBag> = StaticConfig<TypeBag>,
>(config?: Config): TypedNavigator<TypeBag, Config> {
  return createNavigatorFactory(MainTabNavigator)(config);
}
