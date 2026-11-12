# Pinpointer UI kit

Every new or restyled screen is built from these parts and the tokens in
`src/theme/`. The visual spec is the design concept:
https://claude.ai/artifact/5J9fnr87FASsXKzmC6j82E

```ts
import { Button, Screen, ScreenHeader, SearchField } from '../components/ui';
import { Colors, GUTTER, Space, Type } from '../theme';
import { useStrings } from '../i18n';
```

## The look in one paragraph

Light and high-contrast: canvas `#F6F5FA`, white cards, ink text. Violet
(`Colors.primary`) is for buttons, links and the active tab. Pinpointer's
signature is **the beam**, a cyan → blue → violet gradient, and it appears only
on things that *find*: the search ring, the mic (the tab bar's middle button), the main Scan action, progress
fills and the active-tab mark. Never put words on the beam. The second motif
is the **lock-on corners**, four brackets that close in on what was found.
Cyan (`Colors.found`) marks matches, marigold (`Colors.important`) marks
"Important / ज़रूरी".

## Rules

1. **Words**: every visible or spoken string comes from `useStrings().t(key)`
   (`src/i18n/strings.ts`, English + Hindi). Add the key to both `en` and `hi`;
   a test checks they match. No jargon (sync, index, OCR, vault).
2. **Text**: always `AppText` (never bare `Text`). Smallest size is 16sp
   (`label`/`small`), body is 18sp. Never set `fontWeight` with Mukta, pick
   a variant instead.
3. **Touch**: main actions 56dp (`Touch.comfortable`), nothing under 48dp.
   Icon-only buttons need a `label`.
4. **Colour**: semantic names from `Colors` only. Every text colour pair
   passes 4.5:1 and `src/theme/__tests__/theme.test.ts` checks it; add any
   new pair there.
5. **Motion**: tokens from `motion.ts` (`Duration`, `Ease`, `Spring`),
   `useNativeDriver: true`, and respect `useReducedMotion()`. No decorative
   loops; loops only while work runs (listening, searching).
6. **Screens**: wrap in `Screen` (safe area + status bar). Android 15+ draws
   edge to edge, so nothing else pads for the status bar.
7. **Status bar**: let `Screen` set it. Tabs stay mounted in the background,
   so a bare `<StatusBar>` in a tab would fight the visible one.

## Parts

| Part | Use it for |
| --- | --- |
| `AppText` | All text. `variant`: display, title, heading, body, bodyStrong, button, label, labelStrong, small, numeral. `color`: a `Colors` name or a raw colour. |
| `Icon` | 40 stroke icons (`IconName`), 24dp grid. Silent unless given `accessibilityLabel`. `filled` for star/play/stop. |
| `PressableScale` | The base of every tappable thing: shrinks to 0.97 and springs back. |
| `Button` | Text buttons. `variant`: primary (one per screen), secondary, ghost, danger, beam (finding only). `size`: regular 56dp / compact 48dp. `icon`, `iconAfter`, `loading`, `block`. |
| `IconButton` | Round icon buttons, label required. `variant`: plain, tonal, onNight (viewer), beam (mic), primary. `selected` for toggles. |
| `SearchField` | The 60dp search field with the beam ring on focus, clear button and beam mic (`onVoicePress`, `listening`). `onPressFake` turns it into a big button that opens search (Home). |
| `Chip` | Filters and suggestions, 48dp; selected shows a tick. `removable` for recent searches. |
| `Tag` | Small non-tappable labels. `tone`: found, important, neutral, or a category tint. |
| `Card` | White card with hairline border; tappable with `onPress`. `flush` drops padding. |
| `ListRow` | Rows in lists and settings: icon tile or `leading`, title, subtitle, `trailing` or chevron. |
| `CollectionCard` | Home's "Find quickly" tiles (`tint`: id, bill, medicine, bank, screenshot, family). |
| `HighlightedText` | Marks every searched term (case-insensitive, Hindi too). `splitMatches()` is the pure helper. |
| `ProgressBar` / `ProgressRing` | Beam progress; the bar runs on the native driver. `value` undefined = still counting. |
| `ProgressCard` | Indexing progress in plain words: running / paused / done, one action. |
| `EmptyState` | Nothing-yet screens: icon in lock-on corners, title, body, one button. |
| `ScreenHeader` / `SectionHeader` | Screen title (a TalkBack heading), back arrow, actions / group title with "See all". |
| `Thumbnail` | Photo that fades in over a placeholder; small decode for low-RAM phones; icon fallback. |
| `Reveal` | Staggered rise for lists (40ms steps, first 8 only). `playKey` replays it. |
| `Segmented` | 2-3 choices (English / हिन्दी, All / Photos / Papers). |
| `Sheet` / `SheetAction` | Bottom sheet with big action rows (the viewer's Share, Copy text, Important). |
| `ToastProvider` / `useToast` | One short confirmation above the tab bar, read aloud by TalkBack. |
| `TabBar` | The bottom bar (wired by `src/navigation/MainTabs.tsx`). |
| `Screen` | Frame of every screen: `tone` canvas / surface / night. |
| `BeamGradient` / `BeamRing` | The beam as a fill / a ring around a child. |
| `LockOnCorners` | The corners. `searching` keeps them breathing while work runs. |
| `PinMark` | The two-pin mark. |

## Layout notes

- Home's "Find quickly" grid: use **2 columns** on phones. At 3 columns a
  390dp-wide phone breaks "Screenshots" mid-word and cuts "1,240 found".
- Every tappable part is a `PressableScale`, whose `style` sits on the
  pressable itself, so `flex: 1`, `alignSelf` and margins work as on a View.

## Preview

`tools/preview` renders these parts and screens in a browser and saves phone
screenshots (`npm run dev`, `npm run shots`). See its README.

## Hooks and data

- `useStrings()` → `{ lang, t, ago, setLang }`. `ago(ts)` gives "2 hours ago".
- `useReducedMotion()` → true when Android "Remove animations" is on.
- `useScreenFocus()` → true while this screen is the visible one (safe outside a navigator).
- `usePinnedItems()` → `{ items, isPinned(uri), toggle(item) }` for "Important",
  synced across screens. Titles must already be masked.

## Navigation

The app is a stack (`Main`, `SmartClipboard`, `Home`) whose `Main` route holds
four tabs: `Pinpointer` (Home), `Gallery` (Photos), `DocumentVault` (Papers),
`Settings`, with the mic (Speak) in the middle of the bar. Screens type navigation with
`RootStackParamList` (every route by name). Hide the bar with
`navigation.setOptions({ tabBarHidden: true })`.

## Testing

The repo-wide `react-native-svg` mock renders nothing. UI kit tests use
`jest.mock('react-native-svg', () => require('./svgMock').default)` so icons
can be found; query icons with `{ includeHiddenElements: true }` because they
are hidden from TalkBack. A screen test that mocks `@react-navigation/native`
wholesale still works with `Screen` (it falls back to "focused").
