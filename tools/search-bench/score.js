#!/usr/bin/env node
/* eslint-env node */
/**
 * Scores a bench run against the right answers.
 *
 *   node score.js out/desk-results.jsonl            (desk)
 *   node score.js out/device/results.jsonl          (phone)
 *
 * Reads corpus.jsonl and queries.jsonl from the results file's folder (or
 * --corpus DIR), and the run's time from *-run.json / run.json next to it (for
 * "yesterday" and "last month"). Writes <results>.report.json and
 * <results>.report.md, and prints the summary.
 *
 * How each kind of search is scored:
 *   one    the paper asked for: is it 1st, in the top 3, top 10, found at all
 *          (reciprocal rank too). Copies of it count as it.
 *   first  "latest": is the top result one of the right ones.
 *   set    many right answers (a collection, every bill): how many of them are
 *          in the first 10 and the first 50 (recall), and how many of the
 *          first 10 are right (precision; `also` counts as right).
 *   none   nothing should be found: anything found is a false alarm.
 *   smoke  no right answer: must not fail and must answer quickly.
 */
const fs = require('fs');
const path = require('path');

const resultsFile = path.resolve(process.argv[2] ?? path.join(__dirname, 'out', 'desk-results.jsonl'));
const argOf = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const dir = path.dirname(resultsFile);
const corpusDir = path.resolve(argOf('corpus', fs.existsSync(path.join(dir, 'corpus.jsonl')) ? dir : path.join(dir, '..')));
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const PHASE = argOf('phase', 'final'); // 'words': score what search shows first, before CLIP
const docs = readJsonl(path.join(corpusDir, 'corpus.jsonl'));
// A phone run has its own search list (device/photos.js) next to its results.
const queriesFile = argOf('queries', fs.existsSync(path.join(dir, 'queries.jsonl')) ? path.join(dir, 'queries.jsonl') : path.join(corpusDir, 'queries.jsonl'));
const queries = readJsonl(queriesFile);
const results = new Map(readJsonl(resultsFile).map(r => [r.qid, PHASE === 'words' && r.wordIds ? { ...r, ids: r.wordIds, ms: { words: r.ms?.words } } : r]));
// On a phone, only the test files that were copied on can be found.
const presentFile = path.join(dir, 'present.json');
const present = fs.existsSync(presentFile) ? new Set(JSON.parse(fs.readFileSync(presentFile, 'utf8'))) : null;
const onPhone = id => id.startsWith('own:') || !present || present.has(id);
const runFile = [resultsFile.replace(/results\.jsonl$/, 'run.json'), path.join(dir, 'run.json')].find(f => fs.existsSync(f));
const run = runFile ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : { runAt: Date.now() };
const byId = new Map(docs.map(d => [d.id, d]));

// ── Relative dates, as of the run (IST calendar days) ──
const IST = 5.5 * 3600000;
const DAY = 86400000;
const istMidnight = ms => Math.floor((ms + IST) / DAY) * DAY - IST;
const monthStart = (y, m) => Date.UTC(y, m, 1) - IST;
const windowOf = rule => {
  const today = istMidnight(run.runAt);
  const d = new Date(run.runAt + IST);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (rule.window) {
    case 'today': return [today, today + DAY];
    case 'yesterday': return [today - DAY, today];
    case 'lastWeek': return [today - 13 * DAY, today - 6 * DAY]; // the 7 days before this week's 7 (the app's meaning)
    case 'lastMonth': return [monthStart(m === 0 ? y - 1 : y, (m + 11) % 12), monthStart(y, m)];
    case 'month': return [monthStart(rule.year, rule.month), monthStart(rule.month === 11 ? rule.year + 1 : rule.year, (rule.month + 1) % 12)];
    case 'year': return [monthStart(rule.year, 0), monthStart(rule.year + 1, 0)];
    default: throw new Error(`unknown window ${rule.window}`);
  }
};
const expectedIds = q => {
  if (!q.rule) return q.expect.ids;
  const [from, to] = windowOf(q.rule);
  return docs.filter(d => d.takenAt >= from && d.takenAt < to && (!q.rule.categories || q.rule.categories.includes(d.category)) && !d.copyOf).map(d => d.id);
};

const FILLER = new Set(['a', 'an', 'the', 'of', 'in', 'ka', 'ki', 'ke', 'ko', 'my', 'mera', 'meri', 'mere', 'का', 'की', 'के', 'को', 'kitna', 'photo', 'photos', 'card', 'कार्ड']);
const textOf = new Map(docs.map(d => [d.id, [...(d.lines ?? []), ...(d.labels ?? [])].join(' ').toLowerCase()]));
const saysAll = query => {
  const words = query.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(w => w.length > 1 && !FILLER.has(w));
  return id => words.length > 0 && words.every(w => (textOf.get(id) ?? '').includes(w));
};

// A copy stands for its source: finding either is finding the paper.
const canon = id => byId.get(id)?.copyOf ?? id;

const pct = (a, b) => (b === 0 ? null : Math.round((1000 * a) / b) / 10);
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const quantile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

const rows = [];
for (const q of queries) {
  const r = results.get(q.qid);
  const row = { qid: q.qid, text: q.text, kind: q.kind, lang: q.lang, mode: q.mode, note: q.note ?? null };
  if (!r) {
    rows.push({ ...row, missing: true });
    continue;
  }
  const got = (r.ids ?? []).map(canon);
  const gotUnique = [...new Set(got)];
  row.found = got.length;
  row.duplicatesShown = got.length - gotUnique.length;
  row.ms = r.ms ?? {};
  row.error = r.error ?? null;
  row.correctedFrom = r.correctedFrom ?? null;
  row.searched = r.searched ?? null;
  row.top = gotUnique.slice(0, 5);
  const want = [...new Set(expectedIds(q).filter(onPhone).map(canon))];
  if (expectedIds(q).length > 0 && want.length === 0) {
    rows.push({ ...row, notOnPhone: true, missing: true });
    continue;
  }
  const wantSet = new Set(want);
  const okSet = new Set([...want, ...(q.also ?? []).map(canon)]);
  // A result that literally says every word of the search (a chat that says
  // "bijli bill") is not wrong, just not what was asked for: it counts for
  // precision, not for recall.
  const said = saysAll(q.text);
  for (const id of gotUnique.slice(0, 10)) if (said(id)) okSet.add(id);
  row.expected = want.length;
  if (q.mode === 'one') {
    const rank = gotUnique.findIndex(id => wantSet.has(id));
    row.rank = rank >= 0 ? rank + 1 : null;
    row.hit1 = rank === 0;
    row.hit3 = rank >= 0 && rank < 3;
    row.hit10 = rank >= 0 && rank < 10;
    row.foundAtAll = rank >= 0;
    row.rr = rank >= 0 ? 1 / (rank + 1) : 0;
  } else if (q.mode === 'first') {
    row.hit1 = gotUnique.length > 0 && wantSet.has(gotUnique[0]);
    row.foundAtAll = gotUnique.some(id => wantSet.has(id));
  } else if (q.mode === 'set') {
    if (want.length === 0) {
      row.emptyExpectation = true; // nothing from then in this gallery: scored as "nothing should be found"
      row.falseAlarm = gotUnique.some(id => !id.startsWith('own:'));
    } else {
      // The phone's own photos may well be right ("bijli bill" finds your real bill): unknown, left out.
      const top10 = gotUnique.filter(id => !id.startsWith('own:') || wantSet.has(id)).slice(0, 10);
      const top50 = gotUnique.slice(0, 50);
      row.recall10 = top10.filter(id => wantSet.has(id)).length / Math.min(10, want.length);
      row.recall50 = top50.filter(id => wantSet.has(id)).length / Math.min(50, want.length);
      row.precision10 = top10.length ? top10.filter(id => okSet.has(id)).length / top10.length : 0;
      row.foundAtAll = gotUnique.some(id => wantSet.has(id));
      row.wrongInTop10 = top10.filter(id => !okSet.has(id)).slice(0, 5);
    }
  } else if (q.mode === 'none') {
    const bench = gotUnique.filter(id => !id.startsWith('own:'));
    row.falseAlarm = bench.length > 0;
    row.ownOnly = bench.length === 0 && gotUnique.length > 0;
  }
  row.failed = !!row.error;
  rows.push(row);
}

// ── Summaries ──
const group = (key) => {
  const out = {};
  for (const r of rows) (out[r[key]] = out[r[key]] || []).push(r);
  return out;
};
const summarise = rs => {
  const ones = rs.filter(r => r.mode === 'one' && !r.missing);
  const firsts = rs.filter(r => r.mode === 'first' && !r.missing);
  const sets = rs.filter(r => r.mode === 'set' && !r.missing && !r.emptyExpectation);
  const nones = rs.filter(r => (r.mode === 'none' || r.emptyExpectation) && !r.missing);
  const times = rs.filter(r => r.ms?.words != null).map(r => r.ms.words + (r.ms.look ?? 0));
  return {
    searches: rs.length,
    one: ones.length ? { n: ones.length, top1: pct(ones.filter(r => r.hit1).length, ones.length), top3: pct(ones.filter(r => r.hit3).length, ones.length), top10: pct(ones.filter(r => r.hit10).length, ones.length), foundAtAll: pct(ones.filter(r => r.foundAtAll).length, ones.length), mrr: Math.round(1000 * avg(ones.map(r => r.rr))) / 1000 } : null,
    first: firsts.length ? { n: firsts.length, top1: pct(firsts.filter(r => r.hit1).length, firsts.length), foundAtAll: pct(firsts.filter(r => r.foundAtAll).length, firsts.length) } : null,
    set: sets.length ? { n: sets.length, recall10: pct(avg(sets.map(r => r.recall10)) * 100, 100), recall50: pct(avg(sets.map(r => r.recall50)) * 100, 100), precision10: pct(avg(sets.map(r => r.precision10)) * 100, 100), foundNone: sets.filter(r => !r.foundAtAll).length } : null,
    none: nones.length ? { n: nones.length, falseAlarms: nones.filter(r => r.falseAlarm).length, falseAlarmRate: pct(nones.filter(r => r.falseAlarm).length, nones.length) } : null,
    failed: rs.filter(r => r.failed).length,
    missing: rs.filter(r => r.missing && !r.notOnPhone).length,
    notOnPhone: rs.filter(r => r.notOnPhone).length,
    duplicatesShown: rs.reduce((a, r) => a + (r.duplicatesShown ?? 0), 0),
    ms: times.length ? { p50: Math.round(quantile(times, 0.5) * 10) / 10, p95: Math.round(quantile(times, 0.95) * 10) / 10, max: Math.round(Math.max(...times) * 10) / 10 } : null,
  };
};
const report = {
  results: path.relative(process.cwd(), resultsFile),
  run,
  overall: summarise(rows),
  byKind: Object.fromEntries(Object.entries(group('kind')).map(([k, rs]) => [k, summarise(rs)])),
  byLang: Object.fromEntries(Object.entries(group('lang')).map(([k, rs]) => [k, summarise(rs)])),
  misses: rows.filter(r => (r.mode === 'one' && !r.hit3) || (r.mode === 'first' && !r.hit1) || (r.mode === 'set' && !r.emptyExpectation && (r.recall10 ?? 1) < 0.5) || r.falseAlarm || r.failed),
  rows,
};
const base = resultsFile.replace(/\.jsonl$/, '') + (PHASE === 'words' ? '.words' : '');
fs.writeFileSync(`${base}.report.json`, JSON.stringify(report, null, 2));

// ── Markdown ──
const cell = v => (v == null ? '–' : String(v));
const table = (title, groups) => {
  const lines = [`### ${title}`, '', '| | Searches | Paper asked for: 1st / top 3 / top 10 / found | "Latest": right one 1st | Many answers: recall@10 / @50, precision@10 | Should find nothing: false alarms | Failed | ms p50 / p95 |', '|---|---|---|---|---|---|---|---|'];
  for (const [k, s] of Object.entries(groups)) {
    lines.push(`| ${k} | ${s.searches} | ${s.one ? `${s.one.top1}% / ${s.one.top3}% / ${s.one.top10}% / ${s.one.foundAtAll}% (n=${s.one.n})` : '–'} | ${s.first ? `${s.first.top1}% (n=${s.first.n})` : '–'} | ${s.set ? `${s.set.recall10}% / ${s.set.recall50}%, ${s.set.precision10}% (n=${s.set.n})` : '–'} | ${s.none ? `${s.none.falseAlarms} of ${s.none.n}` : '–'} | ${s.failed} | ${s.ms ? `${s.ms.p50} / ${s.ms.p95}` : '–'} |`);
  }
  return lines.join('\n');
};
const missLine = r => {
  const why = r.failed ? `failed: ${r.error}` : r.falseAlarm ? `found ${r.found} (should be none)` : r.mode === 'one' ? (r.rank ? `ranked ${r.rank}` : 'not found') : r.mode === 'first' ? `top was ${cell(r.top[0])}` : `recall@10 ${Math.round(100 * r.recall10)}%, precision@10 ${Math.round(100 * r.precision10)}%`;
  return `| ${r.qid} | \`${r.text.length > 50 ? r.text.slice(0, 50) + '…' : r.text}\` | ${r.kind} | ${why}${r.correctedFrom ? ` (searched "${r.searched}")` : ''} | ${cell(r.note)} |`;
};
const md = [
  `# Search bench report`,
  '',
  `Results: \`${report.results}\` · run at ${new Date(run.runAt).toISOString()} · ${run.where ?? 'device'}${run.device ? ` (${run.device.model}, Android ${run.device.android}, ${run.device.ramGb} GB)` : ''}${run.lookAlikes === false ? ' · words only, no CLIP' : ''}${PHASE === 'words' ? ' · scoring the first, words-only results' : ''}`,
  '',
  table('Overall', { all: report.overall }),
  '',
  table('By kind of search', report.byKind),
  '',
  table('By language', report.byLang),
  '',
  `### Misses (${report.misses.length})`,
  '',
  '| | Search | Kind | What happened | Note |',
  '|---|---|---|---|---|',
  ...report.misses.map(missLine),
  '',
].join('\n');
fs.writeFileSync(`${base}.report.md`, md);
console.log(table('Overall', { all: report.overall }));
console.log('');
console.log(table('By kind of search', report.byKind));
console.log(`\n${report.misses.length} misses → ${path.relative(process.cwd(), base)}.report.md`);
