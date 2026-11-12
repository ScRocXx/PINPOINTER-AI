import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const rootModules = path.join(root, 'node_modules');

const shim = (name: string) => path.resolve(__dirname, 'src/shims', name);

// App modules that need the phone (database, permissions, pickers, text
// reading) are swapped for sample-data stand-ins, so the real screens render.
const APP_SHIMS: Record<string, string> = {
  'src/database': 'database.ts',
  'src/hooks/PinpointerContext': 'PinpointerContext.tsx',
  'src/utils/StoragePermissions': 'StoragePermissions.ts',
  'src/utils/PdfImport': 'PdfImport.ts',
  'src/utils/MissingFiles': 'MissingFiles.ts',
  'src/utils/VisionPipeline': 'VisionPipeline.ts',
};

const appShims = () => ({
  name: 'pinpointer-preview-app-shims',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith('.') || importer.includes(`${path.sep}shims${path.sep}`)) {
      return null;
    }
    const rel = path.relative(root, path.resolve(path.dirname(importer), source)).split(path.sep).join('/');
    return APP_SHIMS[rel] ? shim(APP_SHIMS[rel]) : null;
  },
});

// Renders the app's own src/ in a browser through react-native-web, so screen
// work can be looked at and screenshotted without a phone. Not the real app:
// native modules are absent and fonts/shadows are close, not exact.
export default defineConfig({
  plugins: [appShims(), react()],
  define: { __DEV__: 'true', global: 'globalThis', 'process.env.NODE_ENV': JSON.stringify('development') },
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
      { find: /^@react-navigation\/native$/, replacement: shim('Navigation.tsx') },
      { find: /^@react-native-camera-roll\/camera-roll$/, replacement: shim('CameraRoll.ts') },
      { find: /^react-native-image-picker$/, replacement: shim('ImagePicker.ts') },
      { find: /^@react-native-clipboard\/clipboard$/, replacement: shim('Clipboard.ts') },
    ],
    dedupe: ['react', 'react-dom', 'react-native-web'],
  },
  optimizeDeps: {
    esbuildOptions: { resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'], loader: { '.js': 'jsx' } },
  },
  server: { fs: { allow: [root] }, port: 5199 },
});
