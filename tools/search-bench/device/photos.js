#!/usr/bin/env node
/* eslint-env node */
/**
 * Real photos for the phone bench, and the "what a photo shows" searches
 * with their right answers.
 *
 *   node device/photos.js --coco DIR [--out out] [--own own-queries.csv]
 *
 * DIR holds COCO's val2017 images (val2017/*.jpg) and
 * annotations/instances_val2017.json (cocodataset.org, CC BY 4.0). Each photo
 * of the test gallery that has no text gets one COCO image, in order, until
 * they run out (5,000); the rest are left off the phone (your own photos fill
 * the gallery instead).
 *
 * Writes out/device/photos.json (which image stands for which photo, and what
 * is in it) and out/device/queries.jsonl: the desk searches, minus the desk's
 * label searches, plus searches for what COCO photos show, in English,
 * Hinglish and Hindi (the right answers are the photos COCO says show it),
 * plus your own searches from --own.
 *
 * own-queries.csv: one search per line, "search text,IMG_1.jpg;IMG_2.jpg"
 * (the file names of your photos that are the right answer). Nothing else
 * about your photos is read.
 */
const fs = require('fs');
const path = require('path');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'out')));
const COCO = arg('coco', null);
const OWN = arg('own', path.join(OUT, 'device', 'own-queries.csv'));
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

/**
 * What people search for in their photos: COCO category → the ways they ask.
 * Hinglish and Hindi words the app does not know yet are kept on purpose: the
 * bench should show whether CLIP or the concept table can answer them.
 */
const PICTURE_SEARCHES = [
  ['dog', ['dog', 'dogs', 'photo of a dog'], ['kutta', 'kutte ki photo'], ['कुत्ता']],
  ['cat', ['cat'], ['billi'], ['बिल्ली']],
  ['car', ['car'], ['gaadi'], ['गाड़ी']],
  ['bicycle', ['bicycle', 'cycle'], ['saikil'], ['साइकिल']],
  ['motorcycle', ['motorcycle', 'bike'], ['motor cycle'], ['मोटरसाइकिल']],
  ['bus', ['bus'], [], ['बस']],
  ['train', ['train'], ['rail gaadi'], ['ट्रेन', 'रेलगाड़ी']],
  ['airplane', ['airplane', 'aeroplane'], ['hawai jahaz'], ['हवाई जहाज़']],
  ['bird', ['bird', 'birds'], ['chidiya'], ['चिड़िया']],
  ['horse', ['horse'], ['ghoda'], ['घोड़ा']],
  ['cow', ['cow'], ['gaay'], ['गाय']],
  ['elephant', ['elephant'], ['hathi'], ['हाथी']],
  ['umbrella', ['umbrella'], ['chhata'], ['छाता']],
  ['cake', ['cake', 'birthday cake'], [], ['केक']],
  ['pizza', ['pizza'], [], ['पिज़्ज़ा']],
  ['banana', ['banana'], ['kela'], ['केला']],
  ['clock', ['clock'], ['ghadi'], ['घड़ी']],
  ['bed', ['bed'], ['palang'], ['बिस्तर']],
  ['tv', ['tv', 'television'], [], ['टीवी']],
  ['laptop', ['laptop'], [], ['लैपटॉप']],
  ['cell phone', ['mobile phone'], ['mobile'], ['मोबाइल']],
  ['potted plant', ['plant'], ['paudha'], ['पौधा']],
  ['bench', ['bench'], [], []],
  ['boat', ['boat'], ['naav'], ['नाव']],
  ['kite', ['kite'], ['patang'], ['पतंग']],
];

const main = () => {
  if (!COCO) {
    console.error('Give --coco DIR (COCO val2017 images and annotations). See tools/search-bench/README.md.');
    process.exit(1);
  }
  const ann = JSON.parse(fs.readFileSync(path.join(COCO, 'annotations', 'instances_val2017.json'), 'utf8'));
  const catName = new Map(ann.categories.map(c => [c.id, c.name]));
  const cats = new Map();
  const persons = new Map();
  for (const a of ann.annotations) {
    if (!cats.has(a.image_id)) cats.set(a.image_id, new Set());
    cats.get(a.image_id).add(catName.get(a.category_id));
    if (catName.get(a.category_id) === 'person' && a.area > 4000) persons.set(a.image_id, (persons.get(a.image_id) ?? 0) + 1);
  }
  const images = ann.images.sort((x, y) => x.id - y.id);

  const docs = readJsonl(path.join(OUT, 'corpus.jsonl'));
  const slots = docs.filter(d => !d.lines);
  const photos = {};
  slots.slice(0, images.length).forEach((d, i) => {
    const img = images[i];
    photos[d.id] = { file: path.join('val2017', img.file_name), cats: [...(cats.get(img.id) ?? [])], people: persons.get(img.id) ?? 0 };
  });
  fs.mkdirSync(path.join(OUT, 'device'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'device', 'photos.json'), JSON.stringify({ source: 'COCO val2017', photos }, null, 1));

  // Searches: the desk ones (minus label searches), then COCO picture searches.
  const queries = readJsonl(path.join(OUT, 'queries.jsonl')).filter(q => q.kind !== 'picture');
  let n = 1;
  const add = (text, lang, ids, extra = {}) => queries.push({ qid: `p${String(n++).padStart(4, '0')}`, text, kind: 'picture', lang, mode: 'set', expect: { ids }, ...extra });
  const showing = cat => Object.entries(photos).filter(([, p]) => p.cats.includes(cat)).map(([id]) => id);
  for (const [cat, en, hinglish, hi] of PICTURE_SEARCHES) {
    const ids = showing(cat);
    if (ids.length === 0) continue;
    en.forEach(t => add(t, 'en', ids));
    hinglish.forEach(t => add(t, 'hinglish', ids));
    hi.forEach(t => add(t, 'hi', ids));
  }
  const groups = Object.entries(photos).filter(([, p]) => p.people >= 3).map(([id]) => id);
  add('family photo', 'en', groups, { note: 'three or more people (COCO); the Family tile asks CLIP for this' });
  add('parivar ki photo', 'hinglish', groups);
  add('परिवार की फ़ोटो', 'hi', groups);

  // Your own searches: right answers are your photos' file names.
  let own = 0;
  if (fs.existsSync(OWN)) {
    for (const line of fs.readFileSync(OWN, 'utf8').split(/\r?\n/)) {
      const at = line.lastIndexOf(',');
      if (at <= 0 || line.startsWith('#')) continue;
      const text = line.slice(0, at).trim().replace(/^"|"$/g, '');
      const files = line.slice(at + 1).split(';').map(f => f.trim()).filter(Boolean);
      if (!text || files.length === 0) continue;
      queries.push({ qid: `o${String(++own).padStart(4, '0')}`, text, kind: 'own', lang: /[ऀ-ॿ]/.test(text) ? 'hi' : 'en', mode: files.length === 1 ? 'one' : 'set', expect: { ids: files.map(f => `own:${f}`) } });
    }
  }
  fs.writeFileSync(path.join(OUT, 'device', 'queries.jsonl'), queries.map(q => JSON.stringify(q)).join('\n') + '\n');
  console.log(`${Object.keys(photos).length} COCO photos for ${slots.length} photo slots; ${queries.length} searches (${n - 1} picture, ${own} your own) → ${path.join(OUT, 'device')}`);
};

main();
