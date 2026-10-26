// Mix the sung voice with the optional instrumental pitch guide and
// accompaniment into one mono track.
import { lineNotes, renderNotes, type InstNote, type Timbre } from './instrument';
import type { VocalRender } from './render';
import type { Score, VoiceLine } from './types';
import { singableLines } from './voices';

export type AccompMode = 'off' | 'choir' | 'full';

export interface MixGains {
  voice: number; // 0..1.5
  guide: number; // piano doubling of your part
  accomp: number; // other parts
}

export interface Stems {
  sampleRate: number;
  length: number;
  voice: Float32Array;
  guide: Float32Array;
  accomp: Float32Array;
}

/** Synthesize the instrumental stems once per render (they depend on tempo). */
export function buildStems(score: Score, v: VocalRender, accomp: AccompMode, transpose = 0): Stems {
  const sr = v.sampleRate;
  // span the whole score (accompaniment may continue after the last sung note)
  const length = Math.max(v.pcm.length, Math.ceil((v.tempo.sec(score.totalQ) + v.leadIn + 0.8) * sr));
  const voice = new Float32Array(length);
  for (let i = 0; i < v.pcm.length; i++) voice[i] = v.pcm[i] / 32768;
  const guide = new Float32Array(length);
  const mine = v.line.line;
  // guide: exactly the notes being sung (chosen divisi note)
  const guideNotes: InstNote[] = v.syllables.flatMap((s) => s.notes.map((n) => ({ t0: n.t0, t1: n.t1, midi: n.midi })));
  renderNotes(guide, sr, guideNotes, 'piano', 0.5);
  const acc = new Float32Array(length);
  if (accomp !== 'off') {
    const sung = new Set(singableLines(score).map((l) => l.line.id));
    const others: [VoiceLine, Timbre][] = [];
    for (const p of score.parts) for (const l of p.voices) {
      if (l.id === mine.id) continue;
      const isVocal = sung.has(l.id);
      if (accomp === 'choir' && !isVocal) continue;
      others.push([l, isVocal ? 'organ' : 'strings']);
    }
    const n = Math.max(1, others.length);
    for (const [l, timbre] of others) renderNotes(acc, sr, lineNotes(l, v.tempo, v.leadIn, transpose), timbre, 0.9 / Math.sqrt(n));
  }
  return { sampleRate: sr, length, voice, guide, accomp: acc };
}

/** Mix stems with gains into 16-bit PCM, limiting peaks to avoid clipping. */
export function mixStems(st: Stems, g: MixGains, from = 0, to = st.length): Int16Array {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(st.length, Math.floor(to));
  const out = new Float32Array(b - a);
  let peak = 0;
  for (let i = a; i < b; i++) {
    const x = st.voice[i] * g.voice + st.guide[i] * g.guide + st.accomp[i] * g.accomp;
    out[i - a] = x;
    const ax = x < 0 ? -x : x;
    if (ax > peak) peak = ax;
  }
  const k = peak > 0.97 ? 0.97 / peak : 1;
  const pcm = new Int16Array(out.length);
  for (let i = 0; i < out.length; i++) pcm[i] = Math.round(out[i] * k * 32767);
  return pcm;
}
