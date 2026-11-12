import 'react-native-gesture-handler'; // Must be at the top!
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { StatusBar, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ModelServiceProvider } from './services/ModelService';
import { PinpointerProvider } from './hooks/PinpointerContext';
import { Colors, GUTTER, Space } from './theme';
import {
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

/**
 * "Only some photos" matters where photos are searched. The Photos tab says
 * it in its own page, so the one above the bar is for Home only.
 */
const photoBanner = (routeName: string) =>
  routeName === 'Pinpointer' ? <PhotoAccessBanner style={styles.tabBanner} /> : null;

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
        {/* The light canvas from the first frame; each screen then sets its own. */}
        <StatusBar barStyle="dark-content" backgroundColor={Colors.canvas} />
        {firstRun === 'checking' ? (
          // A blank canvas for the few milliseconds the flag takes to read.
          <View style={styles.checking} testID="first-run-checking" />
        ) : (
        <NavigationContainer>
          <Stack.Navigator
            // A new install starts with the welcome; otherwise the tabs (Home first)
            initialRouteName={firstRun === 'show' ? 'FirstRun' : 'Main'}
            screenOptions={{
              // Every screen draws its own header.
              headerShown: false,
              // The canvas behind a screen that is sliding in: no dark flash.
              cardStyle: { backgroundColor: Colors.canvas },
              ...TransitionPresets.SlideFromRightIOS,
            }}
          >
            {/* Welcome and permissions, once */}
            <Stack.Screen
              name="FirstRun"
              component={FirstRunScreen}
              options={{ gestureEnabled: false }}
            />

            {/* Home, Photos, Papers, Settings */}
            <Stack.Screen name="Main" component={MainTabs} />

            {/* Opened on top of the tabs */}
            <Stack.Screen name="SmartClipboard" component={SmartClipboardScreen} />
            <Stack.Screen name="PdfFolders" component={PdfFoldersScreen} />
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