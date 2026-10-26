// Writes the synthetic closed-score test fixture used by tests (not a real piece).
import { writeFileSync } from 'node:fs';
const src = (await import('node:fs')).readFileSync('tests/engine.test.ts', 'utf8');
const m = /const FIXTURE = `([\s\S]*?)`;/.exec(src)!;
// evaluate the template with the helpers defined in the test
const n = (step: string, oct: number, dur: number, voice: number, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>${voice}</voice>${extra}</note>`;
const ly = (t: string, syl = 'single', num = 1) => `<lyric number="${num}"><syllabic>${syl}</syllabic><text>${t}</text></lyric>`;
const xml = new Function('n', 'ly', 'return `' + m[1] + '`')(n, ly);
writeFileSync('tests/fixtures/closed-score-test.musicxml', xml);
console.log('wrote tests/fixtures/closed-score-test.musicxml', xml.length, 'bytes');
