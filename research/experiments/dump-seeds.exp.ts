/**
 * Writes the Hindi voice model's built-in hotwords, exactly as the app ships
 * them (services/VoiceHotwords.seedHotwords), to results/hindi-seed-words.json
 * for hindi-seeds.exp.py:
 *
 *   npx jest --testMatch '**\/research/experiments/dump-seeds.exp.ts'
 */
import * as fs from 'fs';
import * as path from 'path';
import { seedHotwords } from '../../src/services/VoiceHotwords';

test('dump the built-in hotwords', () => {
  const words = seedHotwords();
  fs.writeFileSync(path.join(__dirname, 'results', 'hindi-seed-words.json'), JSON.stringify(words, null, 0) + '\n');
  expect(words.length).toBeGreaterThan(50);
});
