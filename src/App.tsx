import 'react-native-gesture-handler'; // Must be at the top!
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ModelServiceProvider } from './services/ModelService';
import { PinpointerProvider } from './hooks/PinpointerContext';
import { AppColors } from './theme';
import {
  HomeScreen,
  SpeechToTextScreen,
  PinpointerScreen,
  SmartClipboardScreen,
  PointAndSpeakScreen,
  GalleryScreen,
  DocumentVaultScreen,
} from './screens';
import { setupDatabase, closeDatabase } from './Database';
import { RootStackParamList } from './navigation/types';

const Stack = createStackNavigator<RootStackParamList>();

const App: React.FC = () => {
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // 1. Initialize Pinpoint Search Database
        setupDatabase();

        console.log('All systems initialized successfully');
      } catch (error) {
        console.error('Initialization failed:', error);
      }
    };

    initializeApp();
    // Return cleanup to securely close SQLite database and prevent memory leaks
    return () => {
      closeDatabase();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
            <Stack.Screen name="SpeechToText" component={SpeechToTextScreen} options={{ title: 'Speech to Text' }} />

            {/* New Feature Screens */}
            <Stack.Screen name="SmartClipboard" component={SmartClipboardScreen} options={{ title: 'Scan Images' }} />
            <Stack.Screen name="PointAndSpeak" component={PointAndSpeakScreen} options={{ title: 'Point & Speak' }} />
            <Stack.Screen name="DocumentVault" component={DocumentVaultScreen} options={{ headerShown: false }} />
          </Stack.Navigator>
        </NavigationContainer>
        </PinpointerProvider>
      </ModelServiceProvider>
    </GestureHandlerRootView>
  );
};

export default App;