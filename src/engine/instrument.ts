// Simple, deterministic instrument synthesis for the optional pitch guide and
// accompaniment (never used in place of the singing voice).
import type { TempoMap } from './tempo';
import type { VoiceLine } from './types';

export type Timbre = 'piano' | 'organ' | 'strings';

const HARM: Record<Timbre, number[]> = {
  piano: [1, 0.5, 0.28, 0.16, 0.1, 0.06],
  organ: [1, 0.6, 0.35, 0.2, 0.12, 0.08, 0.05],
  strings: [1, 0.7, 0.5, 0.38, 0.28, 0.2, 0.14, 0.1],
};
const TABLE = 2048;
const tables = new Map<Timbre, Float32Array>();
function table(t: Timbre): Float32Array {
  let tb = tables.get(t);
  if (tb) return tb;
  tb = new Float32Array(TABLE + 1);
  const h = HARM[t];
  const norm = h.reduce((a, b) => a + b, 0);
  for (let i = 0; i <= TABLE; i++) {
    let v = 0;
    for (let k = 0; k < h.length; k++) v += h[k] * Math.sin((2 * Math.PI * (k + 1) * i) / TABLE);
    tb[i] = v / norm;
  }
  tables.set(t, tb);
  return tb;
}

export interface InstNote { t0: number; t1: number; midi: number; gain?: number }

/** Mix notes into `out` (Float32, mono) at sample rate sr. */
export function renderNotes(out: Float32Array, sr: number, notes: InstNote[], timbre: Timbre, gain = 1) {
  const tb = table(timbre);
  for (const n of notes) {
    const f = 440 * Math.pow(2, (n.midi - 69) / 12);
    if (f * 2 > sr / 2) continue;
    const a = Math.max(0, Math.floor(n.t0 * sr));
    const rel = timbre === 'piano' ? 0.08 : 0.06;
    const b = Math.min(out.length, Math.floor((n.t1 + rel) * sr));
    const len = (n.t1 - n.t0) * sr;
    const inc = (f * TABLE) / sr;
    let ph = 0;
    const g = gain * (n.gain ?? 1);
    const att = timbre === 'piano' ? 0.005 * sr : timbre === 'organ' ? 0.02 * sr : 0.06 * sr;
    for (let i = a; i < b; i++) {
      const k = i - a;
      let env = k < att ? k / att : 1;
      if (timbre === 'piano') env *= Math.exp(-k / (sr * (0.9 - Math.min(0.5, f / 2000))));
      if (k > len) env *= Math.max(0, 1 - (k - len) / (rel * sr));
      const idx = ph | 0;
      const fr = ph - idx;
      out[i] += g * env * (tb[idx] + (tb[idx + 1] - tb[idx]) * fr);
      ph += inc;
      if (ph >= TABLE) ph -= TABLE;
    }
  }
}

/** Notes of a voice line (all chord tones), timed with the tempo map. */
export function lineNotes(line: VoiceLine, tempo: TempoMap, offset: number, transpose = 0): InstNote[] {
  const out: InstNote[] = [];
  const pending = new Map<number, InstNote>(); // tied notes by pitch
  for (const e of line.events) {
    if (e.grace || !e.pitches.length) continue;
    for (const p of e.pitches) {
      const t0 = tempo.sec(e.startQ) + offset;
      const t1 = tempo.sec(e.startQ + e.durQ) + offset;
      const tied = e.tieStop ? pending.get(p) : undefined;
      if (tied && Math.abs(tied.t1 - t0) < 1e-6) tied.t1 = t1;
      else {
        const n = { t0, t1, midi: p + transpose };
        out.push(n);
        pending.set(p, n);
      }
    }
  }
  return out;
}
