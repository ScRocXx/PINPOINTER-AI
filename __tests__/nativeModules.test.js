/**
 * React Native's new architecture loads old-style native modules through an
 * interop layer that checks every @ReactMethod when JS first touches the
 * module. One rule is absolute: a method is synchronous
 * (isBlockingSynchronousMethod = true) if and only if it returns a value.
 * A module that breaks it cannot be loaded at all ("TurboModule system
 * assumes returnType == void iff the method is synchronous"). With op-sqlite
 * 11.4.9 that took the database, and the app, down at startup.
 *
 * This reads the Android sources of our own modules and of every native
 * dependency, so a bad version is caught here instead of on a phone.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const sourcesUnder = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'build' && entry.name !== '.cxx') out.push(...sourcesUnder(full));
    } else if (/\.(kt|java)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

/** `@ReactMethod` methods in `source` that break the rule, as "name: why". */
const brokenReactMethods = (source) => {
  const problems = [];
  const annotation = /@ReactMethod\b(\s*\(([^)]*)\))?/g;
  let match;
  while ((match = annotation.exec(source)) !== null) {
    const sync = /isBlockingSynchronousMethod\s*=\s*true/.test(match[2] || '');
    const rest = source.slice(annotation.lastIndex, annotation.lastIndex + 600);

    // Kotlin: fun name(args)[: Type] {      (expression bodies are skipped: the type is inferred)
    const kotlin = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:override|open|internal|public|private|protected|suspend)\s+)*fun\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([\w.<>?, ]+?))?\s*\{/.exec(rest);
    // Java: [modifiers] Type name(args) {
    const java = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|protected|private|static|final|abstract|native|synchronized)\s+)+([\w.<>[\]?, ]+?)\s+(\w+)\s*\(/.exec(rest);

    let name;
    let returnsValue;
    if (kotlin) {
      name = kotlin[1];
      returnsValue = !!kotlin[3] && kotlin[3].trim() !== 'Unit';
    } else if (java) {
      name = java[2];
      returnsValue = java[1].trim() !== 'void';
    } else {
      continue;
    }
    if (sync && !returnsValue) problems.push(`${name}: synchronous but returns nothing`);
    if (!sync && returnsValue) problems.push(`${name}: returns a value but is not synchronous`);
  }
  return problems;
};

describe('brokenReactMethods', () => {
  it('accepts the two legal shapes, in Kotlin and Java', () => {
    expect(brokenReactMethods(`
      @ReactMethod(isBlockingSynchronousMethod = true)
      fun install(): Boolean { return true }
      @ReactMethod
      fun open(path: String, promise: Promise) { }
      @ReactMethod
      public void share(String path) { }
      @ReactMethod(isBlockingSynchronousMethod = true)
      public String name() { return ""; }
      @ReactMethod
      @DoNotStrip
      public abstract void multiGet(ReadableArray keys, Callback callback);
    `)).toEqual([]);
  });

  it('catches the op-sqlite 11.4.9 method that crashed the app', () => {
    expect(brokenReactMethods(`
      @ReactMethod(isBlockingSynchronousMethod = true)
      fun getDylibPath(bundleId: String, name: String) {
          throw Exception("Do not call getDylibPath on Android")
      }
    `)).toEqual(['getDylibPath: synchronous but returns nothing']);
  });

  it('catches the other direction too', () => {
    expect(brokenReactMethods(`
      @ReactMethod
      fun count(): Int { return 1 }
      @ReactMethod
      public boolean ready() { return true; }
      @ReactMethod(isBlockingSynchronousMethod = true)
      public void wait() { }
    `)).toEqual([
      'count: returns a value but is not synchronous',
      'ready: returns a value but is not synchronous',
      'wait: synchronous but returns nothing',
    ]);
  });
});

describe('native modules can be loaded by React Native', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const folders = [
    ['app', path.join(ROOT, 'android', 'app', 'src', 'main', 'java')],
    ...Object.keys(pkg.dependencies)
      .filter((name) => name !== 'react-native' && name !== 'react')
      .map((name) => [name, path.join(ROOT, 'node_modules', name, 'android', 'src')]),
  ];

  it('finds the Android sources it is meant to check', () => {
    expect(sourcesUnder(folders[0][1]).length).toBeGreaterThan(5);
    const opSqlite = folders.find(([name]) => name === '@op-engineering/op-sqlite');
    expect(sourcesUnder(opSqlite[1]).length).toBeGreaterThan(0);
  });

  it.each(folders)('%s: synchronous methods return a value, the others do not', (_name, dir) => {
    const problems = [];
    for (const file of sourcesUnder(dir)) {
      for (const problem of brokenReactMethods(fs.readFileSync(file, 'utf8'))) {
        problems.push(`${path.relative(ROOT, file)} ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
