import 'react-native-gesture-handler'; // Must be at the top!
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ModelServiceProvider } from './services/ModelService';
import { PinpointerProvider } from './hooks/PinpointerContext';
import { AppColors } from './theme';
import {
  HomeScreen,
  PinpointerScreen,
  SmartClipboardScreen,
  GalleryScreen,
  DocumentVaultScreen,
} from './screens';
import { setupDatabase, closeDatabase } from './database';
import { RootStackParamList } from './navigation/types';
import { AppLogger } from './utils/AppLogger';
import { scheduleBackgroundIndexing } from './services/BackgroundIndexingTask';

const Stack = createStackNavigator<RootStackParamList>();

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

  return (
    <GestureHandlerRootView style={styles.root}>
      <ModelServiceProvider>
        <PinpointerProvider>
        <StatusBar barStyle="light-content" backgroundColor={AppColors.primaryDark} />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Pinpointer" // This makes your UI the main screen
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
            {/* --- Pinpointer Screen --- */}
            <Stack.Screen
              name="Pinpointer"
              component={PinpointerScreen}
              options={{ headerShown: false }}
            />

            {/* Existing Hackathon Screens */}
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Gallery" component={GalleryScreen} options={{ headerShown: false }} />

            {/* New Feature Screens */}
            <Stack.Screen name="SmartClipboard" component={SmartClipboardScreen} options={{ title: 'Scan Images' }} />
            <Stack.Screen name="DocumentVault" component={DocumentVaultScreen} options={{ headerShown: false }} />
          </Stack.Navigator>
        </NavigationContainer>
        </PinpointerProvider>
      </ModelServiceProvider>
    </GestureHandlerRootView>
  );
};

export default App;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});