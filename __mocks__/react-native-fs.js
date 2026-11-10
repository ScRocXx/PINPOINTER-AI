/**
 * Mock of react-native-fs — jest.fn stubs + realistic path constants.
 */
const RNFS = {
  unlink: jest.fn(async (_path) => {}),
  exists: jest.fn(async (_path) => true),
  stat: jest.fn(async (_path) => ({ size: 0, mtime: 0, ctime: 0, isFile: () => true, isDirectory: () => false })),
  readFile: jest.fn(async (_path, _encoding) => ''),
  read: jest.fn(async (_path, _length, _position, _encoding) => ''),
  writeFile: jest.fn(async (_path, _data, _encoding) => {}),
  appendFile: jest.fn(async () => {}),
  mkdir: jest.fn(async (_path) => {}),
  readdir: jest.fn(async (_path) => []),
  readDir: jest.fn(async (_path) => []),
  copyFile: jest.fn(async (_src, _dest) => {}),
  moveFile: jest.fn(async (_src, _dest) => {}),
  hash: jest.fn(async () => ''),
  existsAssets: jest.fn(async (_path) => true),
  readDirAssets: jest.fn(async (_path) => []),
  // Path constants used across the app
  DocumentDirectoryPath: '/mock/DocumentDirectoryPath',
  CachesDirectoryPath: '/mock/CachesDirectoryPath',
  DownloadDirectoryPath: '/mock/DownloadDirectoryPath',
  ExternalStorageDirectoryPath: '/mock/ExternalStorageDirectoryPath',
  ExternalDirectoryPath: '/mock/ExternalDirectoryPath',
  TemporaryDirectoryPath: '/mock/TemporaryDirectoryPath',
  LibraryDirectoryPath: '/mock/LibraryDirectoryPath',
  PicturesDirectoryPath: '/mock/PicturesDirectoryPath',
  FileProtectionKeys: {},
};

module.exports = RNFS;
module.exports.default = RNFS;
