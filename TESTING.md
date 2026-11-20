# TESTING.md — PinPointer.AI

How the test suite works, how to run it, and the conventions every test follows.

## Quick start

```bash
# Run the full suite
npx jest --forceExit

# Full suite with coverage report
npx jest --coverage --forceExit

# One area only
npx jest src/utils --forceExit
npx jest src/hooks --forceExit
npx jest src/database --forceExit
npx jest src/screens --forceExit

# Type-check and lint (must stay clean)
npx tsc --noEmit
npx eslint .
```

`--forceExit` is used because React Native's async internals keep the event loop
alive after the run finishes. `testTimeout` is 15s per test.

## Search accuracy and the phone

Unit tests check code; whether search *finds the right thing* in a big gallery
is measured by the search bench (`tools/search-bench/README.md`): a desk run on
real SQLite in seconds, and the same searches on a phone over USB. Everything
else to check with the app open is in `tools/search-bench/CHECKLIST.md`.

## Layout

```
jest.config.js          # preset, transforms, mocks, coverage gates
jest.setup.js           # NativeModules stubs, jest-native matchers, warning filter
__mocks__/              # manual mocks for native packages (ML Kit, RNFS, SQLite…)
src/utils/__tests__/    # unit tests — pure logic
src/hooks/__tests__/    # hook tests — renderHook + act
src/database/__tests__/ # in-memory op-sqlite mock
src/screens/__tests__/  # React Native Testing Library components
```

Tests sit in `__tests__/` next to the code they cover (also under `services/`,
`components/`, `i18n/`, `theme/`, `navigation/`). The current suite and test
counts are in `CLAUDE.md` under Commands.

## Coverage gates (enforced by jest)

| Path            | Statements | Branches | Functions | Lines |
|-----------------|------------|----------|-----------|-------|
| `src/utils/`    | 70%        | 70%      | 70%       | 70%   |
| `src/hooks/`    | 50%        | 50%      | 50%       | 50%   |
| `src/database/` | 70%        | 70%      | 70%       | 70%   |

Current coverage is far above every gate (utils ~95%, hooks ~98%, database ~96%).

## Mock strategy

Native code never runs in tests. Two layers:

1. **`jest.setup.js`** — stubs `NativeModules` entries the source actually calls:
   `MobileCLIPModule` (`encodeImage`/`encodeText`), `NativePdfModule`
   (`getPdfInfo`/`rasterizePages`/`cleanupCache`), `SherpaOnnxModule`
   (`initSTT`/`startRecognition`/`stopRecognition`/`cancelRecognition`),
   `StorageModule` (`openPDF`/`shareImage`/`openAllFilesAccessSettings`).
2. **`__mocks__/`** — package-level mocks: `@react-native-ml-kit/text-recognition`
   (`recognize(uri, script)` with `TextRecognitionScript.LATIN/DEVANAGARI`),
   `@react-native-ml-kit/image-labeling`, `@op-engineering/op-sqlite`
   (deterministic in-memory DB), `react-native-fs`, camera-roll, clipboard,
   image-picker, image-resizer, linear-gradient, svg, gesture-handler.

Tests override mock behavior per-case with `mockResolvedValue` /
`mockRejectedValue` / `mockImplementation`.

## Conventions

- **No `any` in `src/`** (tests excluded). Unknown shapes use `unknown` + narrowing.
- **No raw `console.*` in `src/`** — everything goes through
  `src/utils/AppLogger.ts`, which formats as `[Tag] message` and delegates to
  console. Tests spy on console (or on `AppLogger` when the module under test
  is mocked) and assert exact messages.
- **JSDoc on every export** — what it does, `@param`/`@returns` where non-obvious.
- Tests live next to their module in `__tests__/` and match
  `**/__tests__/**/*.test.[jt]s?(x)`.

## React Native Testing Library (v14) notes

- `render`, `rerender`, `fireEvent`, `act`, `waitFor` are **async — always await**.
- RNTL v14 removed `UNSAFE_*` queries.
- Host-tree traversal: `screen.container.queryAll(predicate)` with host type
  strings like `'Image'`.
- Pressing nested label text usually bubbles to the surrounding pressable.
- Tests with delayed `setTimeout` state changes must drain those timers before
  ending, or state leaks into the next test.
- `useFocusEffect` mocks must capture the callback and invoke it **after** render
  inside `act` — invoking synchronously during render causes infinite re-render.

## Database test gotchas

- Barrel re-exports (`src/database/index.ts`) are getter-only — `jest.spyOn`
  must target the concrete module (`database/documents`, …).
- `jest.requireMock('@op-engineering/op-sqlite').__resetAll()` can evaluate a
  disconnected mock copy; prefer the top-level import or `closeDatabase()` to
  reset the live singleton.
- The in-memory mock implements `execute` synchronously, but real devices return
  a `Promise` from it — production code must use `executeSync` for reads
  (a real empty-vault-on-device bug was caught this way).

## Known quirks

- `PinpointerScreen` tests print `ReferenceError: …after it has been torn down`
  noise from a pending `setTimeout` after the suite ends — harmless, tests pass.
- `gallery` time fixtures are computed relative to module-load midnight so the
  suite is stable across day boundaries.
- `SmartClipboardScreen` guards overlapping toast animations with a sequence
  counter so a second copy can't be dismissed by the first toast's completion.
