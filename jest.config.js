/**
 * jest.config.js — PinPointer.AI test configuration
 *
 * React Native 0.83 + TypeScript, transform via babel-jest.
 * Native modules are mocked in ./jest.setup.js and ./__mocks__/.
 */
module.exports = {
  preset: 'react-native',

  // Global test setup: NativeModules stubs, jest-native matchers
  setupFiles: ['<rootDir>/jest.setup.js'],

  // Transform JS/TS/TSX with babel (uses babel.config.js → @react-native/babel-preset)
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },

  // Don't transform node_modules except RN-ecosystem packages that ship uncompiled code
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|@react-navigation|react-native|@react-native-async-storage|@react-native-camera-roll|@react-native-clipboard|@react-native-ml-kit|react-native-fs|react-native-image-resizer|react-native-image-picker|react-native-linear-gradient|react-native-svg|react-native-gesture-handler|react-native-safe-area-context|@runanywhere|@op-engineering)/)',
  ],

  moduleNameMapper: {
    // Static assets (images, fonts) → stub
    '\\.(jpg|jpeg|png|gif|webp|svg|ttf|otf)$': '<rootDir>/__mocks__/fileMock.js',
    // @op-engineering/op-sqlite is a native (Nitro) module — in jest we always
    // want the deterministic in-memory mock instead of native code.
    '^@op-engineering/op-sqlite$': '<rootDir>/__mocks__/op-sqlite.js',
  },

  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  // tools/preview is a separate browser project with its own node_modules.
  modulePathIgnorePatterns: ['<rootDir>/tools/'],
  testTimeout: 15000,

  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/react-native-screens-mock.js',
  ],

  // Enforced once tests exist (Phase 2+). Phase 1 verification runs without --coverage.
  coverageThreshold: {
    // Directory-prefix keys: jest resolves these to absolute paths and
    // enforces the thresholds on every covered file under the prefix.
    './src/utils/': { branches: 70, functions: 70, lines: 70, statements: 70 },
    './src/hooks/': { branches: 50, functions: 50, lines: 50, statements: 50 },
    './src/database/': { branches: 70, functions: 70, lines: 70, statements: 70 },
  },
};
