# Screen preview (browser)

Renders the app's own `src/` in a browser through react-native-web, so a
screen can be looked at and screenshotted without a phone. It is a separate
npm project: nothing here goes into the APK, and the app's `package.json`
doesn't change.

```bash
cd tools/preview
npm install            # once
npm run dev            # http://localhost:5199/#kit  (#kit-hi, #settings, #settings-hi)
npm run shots -- out   # PNGs of every story at 390x844 (2x), plus -full.png for long pages
npm run shots -- out settings   # only some stories
```

`shots` needs Playwright (`npm i -D playwright && npx playwright install chromium`
if it isn't installed globally).

## Adding a screen

Add an entry to `STORIES` in `src/stories.tsx` that renders the screen's
presentational view with sample props (no context, database or native
modules). Wrap tab screens in `<WithTabs active="...">`. Keep data hooks in
a thin container screen and the layout in a view component, so the view can
be previewed.

## What differs from Android

- Fonts, colours, layout and the beam are the real ones. Shadows (`boxShadow`)
  and text rendering are close, not exact.
- Native modules (ML Kit, CLIP, SQLite, file system) don't exist here.
- `react-native-linear-gradient` and AsyncStorage are small shims in `src/shims/`.
- Always check on a phone before calling a screen done.
