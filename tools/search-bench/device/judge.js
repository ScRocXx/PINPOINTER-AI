#!/usr/bin/env node
/* eslint-env node */
/**
 * Records verdicts from a sheet (device/sheet.js): which numbered photos are
 * right answers for the search and which are not.
 *
 *   node device/judge.js q00405 ok 1-6,9 wrong 7,8,10-14      (--set NAME for out/device/NAME/)
 *
 * Appends to out/device/judged.jsonl ({"qid","id","ok"}); a later verdict for
 * the same photo and search wins. score.js reads it: judged-right photos count
 * as right answers, judged-wrong ones as wrong, for any search.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(path.join(__dirname, '..', 'out'));
const argv = process.argv.slice(2);
const setAt = argv.indexOf('--set');
const DEV = setAt >= 0 ? path.join(OUT, 'device', argv[setAt + 1]) : path.join(OUT, 'device');
if (setAt >= 0) argv.splice(setAt, 2);
const [qid, ...rest] = argv;
if (!qid || rest.length === 0) {
  console.log('node device/judge.js <qid> ok 1-6,9 wrong 7,8');
  process.exit(1);
}
const sheet = JSON.parse(fs.readFileSync(path.join(DEV, 'sheets', `${qid}.json`), 'utf8'));
const numbers = spec =>
  spec
    .split(',')
    .filter(Boolean)
    .flatMap(part => {
      const [a, b] = part.split('-').map(Number);
      return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
    });
const verdicts = [];
for (let i = 0; i < rest.length; i += 2) {
  const ok = rest[i] === 'ok';
  if (!['ok', 'wrong'].includes(rest[i])) throw new Error(`"${rest[i]}": say ok or wrong`);
  for (const n of numbers(rest[i + 1] ?? '')) {
    const item = sheet.items.find(it => it.n === n);
    if (!item) throw new Error(`no photo number ${n} on ${qid}'s sheet`);
    verdicts.push({ qid, id: item.id, ok });
  }
}
const file = path.join(DEV, 'judged.jsonl');
const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const key = v => `${v.qid}\u0000${v.id}`;
const merged = new Map(old.map(v => [key(v), v]));
for (const v of verdicts) merged.set(key(v), v);
fs.writeFileSync(file, [...merged.values()].map(v => JSON.stringify(v)).join('\n') + '\n');
console.log(`${qid}: ${verdicts.filter(v => v.ok).length} right, ${verdicts.filter(v => !v.ok).length} wrong recorded (${merged.size} verdicts in all)`);
