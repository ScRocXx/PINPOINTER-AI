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
/** The nearest folder at or above the results that holds the test gallery. */
const findCorpus = () => {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'corpus.jsonl'))) return d;
    if (path.dirname(d) === d) return path.join(__dirname, 'out');
  }
};
const corpusDir = path.resolve(argOf('corpus', findCorpus()));
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const PHASE = argOf('phase', 'final'); // 'words': score what search shows first, before CLIP
const docs = readJsonl(path.join(corpusDir, 'corpus.jsonl'));
// A phone run has its own search list (device/photos.js) next to its results.
const queriesFile = argOf('queries', fs.existsSync(path.join(dir, 'queries.jsonl')) ? path.join(dir, 'queries.jsonl') : path.join(corpusDir, 'queries.jsonl'));
const queries = readJsonl(queriesFile);
const results = new Map(readJsonl(resultsFile).map(r => [r.qid, PHASE === 'words' && r.wordIds ? { ...r, ids: r.wordIds, ms: { words: r.ms?.words } } : r]));
// On a phone, only the test files that were copied on can be found.
const presentFile = [path.join(dir, 'present.json'), path.join(dir, '..', 'present.json')].find(f => fs.existsSync(f)) ?? path.join(dir, 'present.json');
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

// Judgments: "this photo is / isn't a right answer for this search", made by
// looking at the photos (device/sheet.js makes the pictures to look at).
// out/device/judged.jsonl: {"qid":"…","id":"own:IMG_1.jpg","ok":true}
const judgedFile = path.join(dir, 'judged.jsonl');
const judged = new Map();
if (fs.existsSync(judgedFile)) {
  for (const j of readJsonl(judgedFile)) {
    if (!judged.has(j.qid)) judged.set(j.qid, new Map());
    judged.get(j.qid).set(j.id, !!j.ok);
  }
}

// A copy stands for its source: finding either is finding the paper.
const canon = id => byId.get(id)?.copyOf ?? id;

const pct = (a, b) => (b === 0 ? null : Math.round((1000 * a) / b) / 10);
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const quantile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

const SWEEP = [0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.24];
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
  const verdicts = judged.get(q.qid) ?? new Map();
  // A search whose right answers are only known by looking ("judge"): the judged-right ones.
  if (q.mode === 'judge') for (const [id, ok] of verdicts) if (ok) want.push(id);
  const wantSet = new Set(want);
  const okSet = new Set([...want, ...(q.also ?? []).map(canon), ...[...verdicts].filter(([, ok]) => ok).map(([id]) => id)]);
  const wrongSet = new Set([...verdicts].filter(([, ok]) => !ok).map(([id]) => id));
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
  } else if (q.mode === 'judge') {
    const top10 = gotUnique.slice(0, 10);
    const seen = top10.filter(id => verdicts.has(id));
    row.judgedInTop10 = seen.length;
    row.precision10 = seen.length ? seen.filter(id => okSet.has(id)).length / seen.length : null;
    row.unjudgedInTop10 = top10.length - seen.length;
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
  // Photos without text in the first 10 (words can only match their labels or the placeholder).
  row.textlessInTop10 = gotUnique.slice(0, 10).filter(id => { const d = byId.get(id); return d && !d.lines; }).length;

  // ── What CLIP added: photos in the final list that the words did not find ──
  if (r.wordIds && (r.look || r.clipText)) {
    const words = new Set(r.wordIds.map(canon));
    const isRight = id => okSet.has(id) || said(id);
    const isWrong = id => wrongSet.has(id) || (!isRight(id) && !id.startsWith('own:') && q.mode !== 'judge');
    const added = gotUnique.filter(id => !words.has(id));
    const top10 = gotUnique.slice(0, 10);
    row.clip = {
      text: r.clipText ?? null,
      encoded: !!r.look,
      added: added.length,
      right: added.filter(isRight).length,
      wrong: added.filter(isWrong).length,
      unknown: added.filter(id => !isRight(id) && !isWrong(id)).length,
      wrongInTop10: top10.filter(id => !words.has(id) && isWrong(id)).length,
      wrongIds: added.filter(isWrong).slice(0, 8),
    };
    if (q.mode === 'one') {
      const before = [...new Set(r.wordIds.map(canon))].findIndex(id => wantSet.has(id));
      row.clip.rankBefore = before >= 0 ? before + 1 : null;
      row.clip.pushedDown = before >= 0 && row.rank != null && row.rank > before + 1;
    }
    // What other cutoffs (STAND_OUT_GAP) would have kept, from the recorded distances.
    if (r.look?.nearest?.length && r.look.far != null) {
      row.clip.sweep = {};
      for (const gap of SWEEP) {
        const kept = r.look.nearest.filter(n => n.d <= r.look.far - gap).slice(0, 50).map(n => canon(n.id));
        row.clip.sweep[gap] = { kept: kept.length, right: kept.filter(isRight).length, wrong: kept.filter(isWrong).length, wantFound: kept.filter(id => wantSet.has(id)).length };
      }
    }
  }
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
// ── CLIP: does it add photos that don't belong? ──
const NOTHING = r => r.mode === 'none' || r.emptyExpectation;
const PAPER = r => (r.mode === 'one' || r.mode === 'first') && !['picture', 'own'].includes(r.kind);
const PICTURE = r => r.kind === 'picture' || r.mode === 'judge' || (r.kind === 'own' && r.mode === 'set');
const clipRows = rows.filter(r => r.clip && !r.missing);
const clipGroup = (name, test) => {
  const rs = clipRows.filter(test);
  if (!rs.length) return null;
  const added = rs.reduce((a, r) => a + r.clip.added, 0);
  const right = rs.reduce((a, r) => a + r.clip.right, 0);
  const wrong = rs.reduce((a, r) => a + r.clip.wrong, 0);
  return {
    name,
    searches: rs.length,
    encoded: rs.filter(r => r.clip.encoded).length,
    withAdded: rs.filter(r => r.clip.added > 0).length,
    addedPerSearch: Math.round((10 * added) / rs.length) / 10,
    addedMax: Math.max(...rs.map(r => r.clip.added)),
    rightPct: pct(right, right + wrong),
    wrongInTop10PerSearch: Math.round((10 * rs.reduce((a, r) => a + r.clip.wrongInTop10, 0)) / rs.length) / 10,
    pushedDown: rs.filter(r => r.clip.pushedDown).length,
  };
};
const clipSummary = clipRows.length
  ? {
      groups: [clipGroup('Should find nothing', NOTHING), clipGroup('Asking for a paper', PAPER), clipGroup('What a photo shows', PICTURE), clipGroup('All searches', () => true)].filter(Boolean),
      sweep: SWEEP.map(gap => {
        const at = test => clipRows.filter(r => test(r) && r.clip.sweep);
        const sum = (rs, k) => rs.reduce((a, r) => a + r.clip.sweep[gap][k], 0);
        const nothing = at(NOTHING);
        const paper = at(PAPER);
        const picture = at(PICTURE);
        const wantTotal = picture.reduce((a, r) => a + Math.min(50, r.expected || 0), 0);
        return {
          gap,
          nothingWithAny: nothing.filter(r => r.clip.sweep[gap].kept > 0).length,
          nothingN: nothing.length,
          paperKept: paper.length ? Math.round((10 * sum(paper, 'kept')) / paper.length) / 10 : null,
          paperWrong: paper.length ? Math.round((10 * sum(paper, 'wrong')) / paper.length) / 10 : null,
          picturePrecision: pct(sum(picture, 'right'), sum(picture, 'right') + sum(picture, 'wrong')),
          pictureRecall: pct(sum(picture, 'wantFound'), wantTotal),
        };
      }),
      worst: [...clipRows].sort((a, b) => b.clip.wrong - a.clip.wrong).slice(0, 25).filter(r => r.clip.wrong > 0),
    }
  : null;

// Photos without text in searches that ask for words (not pictures, dates or the placeholder test).
const wordy = rows.filter(r => !r.missing && !['picture', 'date', 'placeholder', 'short', 'syntax', 'garbage'].includes(r.kind) && r.textlessInTop10 != null);
const textless = {
  searches: wordy.length,
  withAny: wordy.filter(r => r.textlessInTop10 > 0).length,
  perSearch: wordy.length ? Math.round((10 * wordy.reduce((a, r) => a + r.textlessInTop10, 0)) / wordy.length) / 10 : null,
  worst: [...wordy].sort((a, b) => b.textlessInTop10 - a.textlessInTop10).slice(0, 10).filter(r => r.textlessInTop10 > 0).map(r => `${r.text} (${r.textlessInTop10})`),
};

const report = {
  results: path.relative(process.cwd(), resultsFile),
  clip: clipSummary,
  textless,
  run,
  overall: summarise(rows),
  byKind: Object.fromEntries(Object.entries(group('kind')).map(([k, rs]) => [k, summarise(rs)])),
  byLang: Object.fromEntries(Object.entries(group('lang')).map(([k, rs]) => [k, summarise(rs)])),
  misses: rows.filter(r => !r.missing).filter(r => (r.mode === 'one' && !r.hit3) || (r.mode === 'first' && !r.hit1) || (r.mode === 'set' && !r.emptyExpectation && (r.recall10 ?? 1) < 0.5) || (r.mode === 'judge' && (r.precision10 ?? 1) < 0.5) || r.falseAlarm || r.failed),
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
  const why = r.failed ? `failed: ${r.error}` : r.falseAlarm ? `found ${r.found} (should be none)` : r.mode === 'one' ? (r.rank ? `ranked ${r.rank}` : 'not found') : r.mode === 'first' ? `top was ${cell(r.top?.[0])}` : r.mode === 'judge' ? `precision@10 ${Math.round(100 * r.precision10)}% of ${r.judgedInTop10} judged` : `recall@10 ${Math.round(100 * r.recall10)}%, precision@10 ${Math.round(100 * r.precision10)}%`;
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
  ...(clipSummary
    ? [
        '### Photo look-alikes (CLIP): what it adds',
        '',
        'Photos in the final list that the words did not find. Right = an answer of the search (or judged right); wrong = not an answer (or judged wrong); your own unjudged photos are unknown.',
        '',
        '| | Searches | CLIP ran | Added any | Added per search (max) | Of added: right | Wrong ones in top 10, per search | Pushed the right paper down |',
        '|---|---|---|---|---|---|---|---|',
        ...clipSummary.groups.map(g => `| ${g.name} | ${g.searches} | ${g.encoded} | ${g.withAdded} | ${g.addedPerSearch} (${g.addedMax}) | ${cell(g.rightPct)}% | ${g.wrongInTop10PerSearch} | ${g.pushedDown} |`),
        '',
        `Other cutoffs, from the recorded distances (the app uses STAND_OUT_GAP = 0.12; larger = stricter):`,
        '',
        '| Gap | Should find nothing: searches with any look-alike | Paper searches: look-alikes kept / wrong, per search | Picture searches: precision / recall |',
        '|---|---|---|---|',
        ...clipSummary.sweep.map(w => `| ${w.gap}${w.gap === 0.12 ? ' (now)' : ''} | ${w.nothingWithAny} of ${w.nothingN} | ${cell(w.paperKept)} / ${cell(w.paperWrong)} | ${cell(w.picturePrecision)}% / ${cell(w.pictureRecall)}% |`),
        '',
        '**Most wrong look-alikes**',
        '',
        '| | Search | CLIP was shown | Added | Wrong | Wrong ones (first 8) |',
        '|---|---|---|---|---|---|',
        ...clipSummary.worst.map(r => `| ${r.qid} | \`${r.text}\` | ${cell(r.clip.text)} | ${r.clip.added} | ${r.clip.wrong} | ${r.clip.wrongIds.join(' ')} |`),
        '',
      ]
    : []),
  '### Photos without text in word searches',
  '',
  `${textless.withAny} of ${textless.searches} word searches show photos without text in their top 10 (${cell(textless.perSearch)} per search). Most: ${textless.worst.join(', ') || 'none'}.`,
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
if (clipSummary) {
  console.log('\nCLIP look-alikes:');
  for (const g of clipSummary.groups) console.log(`  ${g.name}: ${g.withAdded} of ${g.searches} searches got look-alikes, ${g.addedPerSearch} per search, ${cell(g.rightPct)}% of them right, ${g.pushedDown} pushed the right paper down`);
}
console.log(`\n${report.misses.length} misses → ${path.relative(process.cwd(), base)}.report.md`);
