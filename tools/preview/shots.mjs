// Screenshot every story at phone size: node shots.mjs [outDir] [story...]
// Needs `npm run dev` running (or set PREVIEW_URL).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Playwright isn't a dependency (it's big): use a global install, or
// `npm i -D playwright && npx playwright install chromium` here.
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright not found. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const base = process.env.PREVIEW_URL ?? 'http://localhost:5199/';
const outDir = process.argv[2] ?? 'shots';
const only = process.argv.slice(3);
const storiesSrc = fs.readFileSync(new URL('./src/stories.tsx', import.meta.url), 'utf8');
const ids = [...storiesSrc.matchAll(/^\s+'?([a-z0-9-]+)'?: \{ title:/gm)].map(m => m[1]).filter(id => !only.length || only.includes(id));

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
for (const id of ids) {
  await page.goto(`${base}#${id}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  const file = path.join(outDir, `${id}.png`);
  await page.screenshot({ path: file, fullPage: false });
  // Also the full scroll height of the first scroll view, for long pages.
  const full = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).overflowY === 'auto' || getComputedStyle(d).overflowY === 'scroll');
    return el ? el.scrollHeight : 0;
  });
  if (full > 844) {
    const tall = await browser.newPage({ viewport: { width: 390, height: Math.min(full + 120, 6000) }, deviceScaleFactor: 1 });
    await tall.goto(`${base}#${id}`);
    await tall.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    await tall.waitForTimeout(900);
    await tall.screenshot({ path: path.join(outDir, `${id}-full.png`) });
    await tall.close();
  }
  console.log('saved', file);
}
await browser.close();
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
