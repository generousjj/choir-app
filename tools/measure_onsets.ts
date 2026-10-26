// Measure, for every onset consonant + vowel pair of a voice, how long after
// the vowel's phoneme boundary the voice actually becomes voiced (aspiration /
// voice-onset time and diphone transition). The singer starts the vowel that
// much earlier so the audible pitch lands on the beat.
//   npx tsx tools/measure_onsets.ts us3   → public/voices/us3.onsets.json
import { writeFileSync } from 'node:fs';
import { createNodeMbrola } from '../src/engine/mbrola-node';

const voice = process.argv[2] ?? 'us3';
const mb = await createNodeMbrola([voice]);
const CONS = ['_', 'p', 't', 'k', 'b', 'd', 'g', 'tS', 'dZ', 'f', 'v', 'T', 'D', 's', 'z', 'S', 'Z', 'h', 'm', 'n', 'N', 'l', 'r', 'w', 'j'];
const VOW = ['i', 'I', 'E', '{', 'A', 'O', 'U', 'u', 'V', 'r=', 'AI', 'aU', 'OI', 'EI', '@U'];
const HZ = 150;
const out: Record<string, number> = {};

function voicedAt(x: Float32Array, sr: number, i0: number): boolean {
  const N = Math.round(0.03 * sr);
  const lag = Math.round(sr / HZ);
  let e0 = 0, e1 = 0, c = 0;
  for (let i = i0; i < i0 + N && i + lag < x.length; i++) { e0 += x[i] * x[i]; e1 += x[i + lag] * x[i + lag]; c += x[i] * x[i + lag]; }
  const rms = Math.sqrt(e0 / N);
  return rms > 0.01 && c / Math.sqrt(e0 * e1 + 1e-12) > 0.75;
}

for (const c of CONS) for (const v of VOW) {
  const pre = c === '_' ? '' : `${c} 90 0 ${HZ} 100 ${HZ}\n`;
  const pho = `_ 300\n${pre}${v} 700 0 ${HZ} 100 ${HZ}\n_ 200\n`;
  const r = mb.synth(pho, voice);
  if (r.warnings.length) continue; // diphone missing
  const sr = r.sampleRate;
  const x = Float32Array.from(r.pcm, (s) => s / 32768);
  const vStart = Math.round((0.3 + (pre ? 0.09 : 0)) * sr);
  let d = -1;
  for (let i = vStart; i < vStart + 0.4 * sr; i += Math.round(0.005 * sr)) if (voicedAt(x, sr, i)) { d = (i - vStart) / sr; break; }
  if (d >= 0) out[`${c} ${v}`] = Math.round(d * 1000);
}
writeFileSync(`public/voices/${voice}.onsets.json`, JSON.stringify(out));
const by = (c: string) => VOW.map((v) => out[`${c} ${v}`]).filter((x) => x !== undefined);
for (const c of CONS) { const a = by(c); console.log(c.padEnd(3), 'voicing delay ms: median', a.sort((p, q) => p - q)[a.length >> 1], ' max', Math.max(...a)); }
