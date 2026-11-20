/* eslint-env node */
/**
 * Jest config for the desk bench: the app's own config, but with
 * @op-engineering/op-sqlite mapped to a real SQLite engine (desk/nodeSqlite.js)
 * instead of the in-memory mock, and only the bench files as tests.
 * Run from the repo root: npx jest --config tools/search-bench/jest.config.js
 */
const path = require('path');

// The app reads "kal" and "last month" in the phone's time zone; the gallery is Indian (IST).
process.env.TZ = 'Asia/Kolkata';
const base = require('../../jest.config.js');

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, '../..'),
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@op-engineering/op-sqlite$': '<rootDir>/tools/search-bench/desk/nodeSqlite.js',
  },
  testMatch: ['<rootDir>/tools/search-bench/desk/**/*.bench.ts'],
  modulePathIgnorePatterns: ['<rootDir>/tools/preview/'],
  coverageThreshold: undefined,
  testTimeout: 60 * 60 * 1000,
};
