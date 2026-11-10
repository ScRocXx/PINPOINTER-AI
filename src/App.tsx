import 'react-native-gesture-handler'; // Must be at the top!
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { StatusBar, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ModelServiceProvider } from './services/ModelService';
import { PinpointerProvider } from './hooks/PinpointerContext';
import { AppColors, Colors, GUTTER, Space } from './theme';
import {
  HomeScreen,
  PinpointerScreen,
  SmartClipboardScreen,
  GalleryScreen,
  DocumentVaultScreen,
  SettingsScreen,
  PdfFoldersScreen,
  FirstRunScreen,
} from './screens';
import { setupDatabase, closeDatabase } from './database';
import { MainTabParamList, StackParamList } from './navigation/types';
import { createMainTabNavigator } from './navigation/MainTabs';
import { LanguageProvider } from './i18n';
import { ToastProvider } from './components/ui';
import { PhotoAccessBanner } from './components/PhotoAccessBanner';
import { useFirstRunGate } from './hooks/useFirstRun';
import { AppLogger } from './utils/AppLogger';
import { scheduleBackgroundIndexing } from './services/BackgroundIndexingTask';

const Stack = createStackNavigator<StackParamList>();
const Tabs = createMainTabNavigator<MainTabParamList>();

/** Tabs where photos are searched or browsed, so "only some photos" matters there. */
const PHOTO_TABS = new Set(['Pinpointer', 'Gallery']);

const photoBanner = (routeName: string) =>
  PHOTO_TABS.has(routeName) ? <PhotoAccessBanner style={styles.tabBanner} /> : null;

/** The four tabs, with Scan in the middle of the bar. */
const MainTabs: React.FC = () => (
  <Tabs.Navigator
    initialRouteName="Pinpointer"
    onScanPress={navigation => navigation.navigate('SmartClipboard')}
    banner={photoBanner}
  >
    <Tabs.Screen name="Pinpointer" component={PinpointerScreen} options={{ tabLabelKey: 'tab.home', tabIcon: 'home' }} />
    <Tabs.Screen name="Gallery" component={GalleryScreen} options={{ tabLabelKey: 'tab.photos', tabIcon: 'photos' }} />
    <Tabs.Screen
      name="DocumentVault"
      component={DocumentVaultScreen}
      options={{ tabLabelKey: 'tab.papers', tabIcon: 'papers' }}
    />
    <Tabs.Screen name="Settings" component={SettingsScreen} options={{ tabLabelKey: 'tab.settings', tabIcon: 'settings' }} />
  </Tabs.Navigator>
);

/**
 * App root: initializes the SQLite database, wires the navigation stack,
 * and provides the model service and Pinpointer shared state.
 */
const App: React.FC = () => {
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // 1. Initialize Pinpoint Search Database
        setupDatabase();

        // 2. Let Android index the rest of the gallery while the phone charges
        scheduleBackgroundIndexing();

        AppLogger.info('App', 'All systems initialized successfully');
      } catch (error) {
        AppLogger.error('App', 'Initialization failed:', error);
      }
    };

    initializeApp();
    // Return cleanup to securely close SQLite database and prevent memory leaks
    return () => {
      closeDatabase();
    };
  }, []);

  // After the database is set up (effects run in order): a new install opens
  // the welcome steps, everyone else goes straight to Home.
  const firstRun = useFirstRunGate();

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
      <LanguageProvider>
      <ToastProvider>
      <ModelServiceProvider>
        <PinpointerProvider>
        <StatusBar barStyle="light-content" backgroundColor={AppColors.primaryDark} />
        {firstRun === 'checking' ? (
          // A blank canvas for the few milliseconds the flag takes to read.
          <View style={styles.checking} testID="first-run-checking" />
        ) : (
        <NavigationContainer>
          <Stack.Navigator
            // A new install starts with the welcome; otherwise the tabs (Home first)
            initialRouteName={firstRun === 'show' ? 'FirstRun' : 'Main'}
            screenOptions={{
              headerStyle: {
                backgroundColor: AppColors.primaryDark,
                elevation: 0,
                shadowOpacity: 0,
              },
              headerTintColor: AppColors.textPrimary,
              headerTitleStyle: { fontWeight: '700', fontSize: 18 },
              cardStyle: { backgroundColor: AppColors.primaryDark },
              ...TransitionPresets.SlideFromRightIOS,
            }}
          >
            {/* Welcome and permissions, once */}
            <Stack.Screen
              name="FirstRun"
              component={FirstRunScreen}
              options={{ headerShown: false, gestureEnabled: false, cardStyle: { backgroundColor: Colors.canvas } }}
            />

            {/* Home, Photos, Papers, Settings */}
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />

            {/* Opened on top of the tabs */}
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="SmartClipboard" component={SmartClipboardScreen} options={{ headerShown: false }} />
            <Stack.Screen name="PdfFolders" component={PdfFoldersScreen} options={{ headerShown: false }} />
          </Stack.Navigator>
        </NavigationContainer>
        )}
        </PinpointerProvider>
      </ModelServiceProvider>
      </ToastProvider>
      </LanguageProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

export default App;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  checking: { flex: 1, backgroundColor: Colors.canvas },
  tabBanner: { marginHorizontal: GUTTER, marginBottom: Space.sm },
});