import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const rootModules = path.join(root, 'node_modules');

// Renders the app's own src/ in a browser through react-native-web, so screen
// work can be looked at and screenshotted without a phone. Not the real app:
// native modules are absent and fonts/shadows are close, not exact.
export default defineConfig({
  plugins: [react()],
  define: { __DEV__: 'true', 'process.env.NODE_ENV': JSON.stringify('development') },
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.json'],
    alias: [
      { find: /^react-native$/, replacement: path.resolve(__dirname, 'node_modules/react-native-web') },
      { find: /^react-native-linear-gradient$/, replacement: path.resolve(__dirname, 'src/shims/LinearGradient.tsx') },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: path.resolve(__dirname, 'src/shims/AsyncStorage.ts') },
      { find: /^react$/, replacement: path.join(rootModules, 'react') },
      { find: /^react\/(.*)$/, replacement: path.join(rootModules, 'react/$1') },
      { find: /^react-native-svg$/, replacement: path.join(rootModules, 'react-native-svg') },
      { find: /^react-native-safe-area-context$/, replacement: path.join(rootModules, 'react-native-safe-area-context') },
      { find: /^@react-navigation\/native$/, replacement: path.join(rootModules, '@react-navigation/native') },
    ],
    dedupe: ['react', 'react-dom', 'react-native-web'],
  },
  optimizeDeps: {
    esbuildOptions: { resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'], loader: { '.js': 'jsx' } },
  },
  server: { fs: { allow: [root] }, port: 5199 },
});
