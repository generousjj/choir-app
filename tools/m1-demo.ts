// Milestone 1 proof: sing short English phrases at explicit pitches.
//   npx tsx tools/m1-demo.ts out-dir
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseCmuDict, Phonemizer } from '../src/engine/phonemizer';
import { buildPho, type TimedSyllable } from '../src/engine/singer';
import { createNodeMbrola } from '../src/engine/mbrola-node';
import { encodeWav } from '../src/engine/wav';

const outDir = process.argv[2] ?? 'out';
const voice = process.argv[3] ?? 'us2';
mkdirSync(outDir, { recursive: true });
const mb = await createNodeMbrola([voice]);
const ph = new Phonemizer(parseCmuDict(readFileSync('assets/dict/cmudict.dict', 'utf8')));

const N: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (n: string) => { const m = /^([A-G])(#|b)?(\d)$/.exec(n)!; return 12 * (+m[3] + 1) + N[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };

// [word, syllables, notes per syllable, beats per note]
type W = [string, string[], string[][], number[][]];
const phrases: Record<string, { bpm: number; words: W[] }> = {
  hallelujah: { bpm: 80, words: [
    ['Hallelujah', ['Hal', 'le', 'lu', 'jah'], [['D3'], ['F#3'], ['A3'], ['D4']], [[1], [1], [1], [2]]],
    ['Hallelujah', ['Hal', 'le', 'lu', 'jah'], [['A3'], ['F#3'], ['E3'], ['D3']], [[1], [1], [1], [2]]],
  ] },
  omnipotent: { bpm: 80, words: [
    ['For', ['For'], [['D3']], [[1]]], ['the', ['the'], [['E3']], [[1]]], ['Lord', ['Lord'], [['F#3']], [[1]]], ['God', ['God'], [['G3']], [[1]]],
    ['omnipotent', ['om', 'ni', 'po', 'tent'], [['A3'], ['B3'], ['C#4'], ['D4']], [[1], [1], [1], [1]]],
    ['reigneth', ['reign', 'eth'], [['A3'], ['D3']], [[2], [2]]],
  ] },
  kingofkings: { bpm: 80, words: [
    ['King', ['King'], [['G2']], [[1]]], ['of', ['of'], [['B2']], [[1]]], ['Kings', ['Kings'], [['D3']], [[2]]],
    ['and', ['and'], [['G3']], [[1]]], ['Lord', ['Lord'], [['F#3']], [[1]]], ['of', ['of'], [['E3']], [[1]]], ['Lords', ['Lords'], [['D3', 'C#3', 'D3']], [[1, 0.5, 2.5]]],
  ] },
};

for (const [name, p] of Object.entries(phrases)) {
  const spb = 60 / p.bpm;
  let t = 0;
  const sylls: TimedSyllable[] = [];
  const truth: { text: string; midi: number; t0: number; t1: number }[] = [];
  for (const [word, syls, notes, beats] of p.words) {
    const phon = ph.syllabify(word, syls);
    syls.forEach((s, k) => {
      const ns = notes[k].map((n, j) => { const d = beats[k][j] * spb; const r = { t0: t, t1: t + d, midi: midi(n) }; t += d; return r; });
      sylls.push({ index: sylls.length, text: s, phon: phon[k], notes: ns });
      ns.forEach((n) => truth.push({ text: s, midi: n.midi, t0: n.t0, t1: n.t1 }));
    });
  }
  const { pho, timing } = buildPho(sylls);
  const { pcm, sampleRate, warnings } = mb.synth(pho, voice);
  if (warnings.length) console.warn('MBROLA warnings:', warnings);
  writeFileSync(`${outDir}/${name}.wav`, encodeWav(pcm, sampleRate));
  writeFileSync(`${outDir}/${name}.pho`, pho);
  writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ leadIn: 0.3, truth, timing: timing.syllables, phon: sylls.map((s) => ({ text: s.text, ...s.phon })) }, null, 1));
  console.log(name, (pcm.length / sampleRate).toFixed(2) + 's', sylls.map((s) => `${s.text}=[${s.phon.onset.join(' ')}|${s.phon.nucleus.join(' ')}|${s.phon.coda.join(' ')}]`).join(' '));
}
