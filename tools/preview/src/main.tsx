import React from 'react';
import { AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../../../src/i18n';
import { ToastProvider } from '../../../src/components/ui';
import { STORIES } from './stories';
import { loadFonts } from './fonts';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } };

const App: React.FC = () => {
  const id = window.location.hash.replace('#', '') || 'kit';
  const story = STORIES[id] ?? STORIES.kit;
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <LanguageProvider initialLanguage={story.lang}>
        <ToastProvider>{story.render()}</ToastProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
};

loadFonts().finally(() => {
  AppRegistry.registerComponent('preview', () => App);
  AppRegistry.runApplication('preview', { rootTag: document.getElementById('root') });
  (window as unknown as { __ready: boolean }).__ready = true;
});
window.addEventListener('hashchange', () => window.location.reload());
