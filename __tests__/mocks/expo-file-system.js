/**
 * expo-file-system, stubbed. Shared by the `expo-file-system` and
 * `expo-file-system/legacy` mocks in __tests__/setup/edge-mocks.js — the app
 * imports both entry points from different modules (pdf export uses the legacy
 * surface, photo caching uses the SDK 52+ File/Directory API), so both have to
 * resolve to the same in-memory stand-in.
 *
 * Exported as a factory rather than a module object because `jest.mock`'s
 * second argument must be an inline function; the setup file calls
 * `jest.mock('expo-file-system', () => require('...')())`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

module.exports = function fileSystemMock() {
  const documentDirectory = 'file:///smoke-test/documents/';
  const cacheDirectory = 'file:///smoke-test/cache/';

  class File {
    constructor(...parts) {
      this.uri = parts.map(String).join('/');
    }
    get exists() { return false; }
    get size() { return 0; }
    text() { return ''; }
    base64() { return ''; }
    bytes() { return new Uint8Array(); }
    create() {}
    write() {}
    delete() {}
    copy() {}
    move() {}
  }

  class Directory {
    constructor(...parts) {
      this.uri = parts.map(String).join('/');
    }
    get exists() { return false; }
    list() { return []; }
    create() {}
    delete() {}
  }

  return {
    __esModule: true,
    documentDirectory,
    cacheDirectory,
    bundleDirectory: 'file:///smoke-test/bundle/',
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
    getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false, uri: '', size: 0 })),
    readAsStringAsync: jest.fn(async () => ''),
    writeAsStringAsync: jest.fn(async () => {}),
    deleteAsync: jest.fn(async () => {}),
    copyAsync: jest.fn(async () => {}),
    moveAsync: jest.fn(async () => {}),
    makeDirectoryAsync: jest.fn(async () => {}),
    readDirectoryAsync: jest.fn(async () => []),
    downloadAsync: jest.fn(async () => ({ uri: '', status: 200, headers: {} })),
    uploadAsync: jest.fn(async () => ({ status: 200, body: '', headers: {} })),
    createDownloadResumable: jest.fn(() => ({
      downloadAsync: jest.fn(async () => ({ uri: '', status: 200 })),
      pauseAsync: jest.fn(async () => {}),
      resumeAsync: jest.fn(async () => {}),
    })),
    getContentUriAsync: jest.fn(async () => ''),
    getFreeDiskStorageAsync: jest.fn(async () => 1_000_000_000),
    File,
    Directory,
    Paths: { document: documentDirectory, cache: cacheDirectory },
  };
};
