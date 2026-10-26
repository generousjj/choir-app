// Singing score → MBROLA .pho instructions.
//
// MBROLA is a diphone concatenation synthesizer: for every phoneme we give an
// exact duration (ms) and pitch targets (Hz at % positions). That makes the
// result fully deterministic: the same score always produces the same audio
// with the same timing, which is what lets us sync lyrics to the sample.
//
// Singing conventions implemented here:
//  * Onset consonants are sung *before* the beat so the vowel lands on it.
//  * Vowels are sustained for the full note; melismas keep one vowel and step
//    the pitch at each note boundary with a short glide (legato).
//  * Coda consonants close the syllable just before the next onset/rest.
//  * Diphthongs on long notes hold the first vowel and glide late ("ah-ee").
//  * Unstressed schwa on long notes becomes a sung "uh" (V).
//  * Optional, deterministic vibrato that starts after the note settles.

import { MBROLA_VOWELS } from './phonemizer';
import type { PhonSyllable } from './types';

export interface TimedNote {
  t0: number; // seconds
  t1: number;
  midi: number;
}

export interface TimedSyllable {
  index: number;
  text: string;
  phon: PhonSyllable;
  notes: TimedNote[];
}

export interface SingOptions {
  vibratoCents: number;
  vibratoRate: number;
  vibratoDelay: number;
  /** Pitch glide length between legato notes (s). */
  glide: number;
  /** Multiplies consonant durations. */
  consonantScale: number;
  /** Semitones added to every note (e.g. -12 to sing an octave lower). */
  transpose: number;
  leadIn: number;
  tail: number;
  /**
   * MBROLA truncates every pitch period to a whole number of samples at the
   * voice's sample rate, which makes notes up to ~25 cents sharp. We request
   * a slightly lower frequency so truncation becomes rounding; vibrato then
   * dithers the period so the *average* pitch is exact. 0 disables.
   */
  periodRate: number;
  /**
   * Measured voicing delay (ms) of this voice for "consonant vowel" pairs
   * (tools/measure_onsets.ts, e.g. aspiration after p/t/k). The vowel is
   * started that much before the beat so the audible pitch lands on it.
   */
  onsetDelay?: Record<string, number>;
}

export const DEFAULT_SING: SingOptions = {
  // Off by default: a steady, pure pitch is easiest to learn from.
  vibratoCents: 0,
  vibratoRate: 5.2,
  vibratoDelay: 0.35,
  glide: 0.025,
  consonantScale: 1,
  transpose: 0,
  leadIn: 0.3,
  tail: 0.5,
  // Our MBROLA build carries fractional pitch periods (wasm/patches), so no
  // compensation is needed; set 16000 only when running stock MBROLA.
  periodRate: 0,
};

export interface Segment {
  ph: string;
  t0: number;
  t1: number;
  syl: number; // syllable index, -1 for silence
  kind: 'onset' | 'nucleus' | 'coda' | 'rest';
  pitches: [number, number][]; // [pct, Hz]
}

export interface SungTiming {
  /** Times are in seconds of the rendered audio (including lead-in). */
  syllables: { index: number; text: string; t0: number; vowelT0: number; t1: number }[];
  segments: Segment[];
  duration: number;
}

const CONS_DUR: Record<string, number> = {
  p: 0.07, t: 0.065, k: 0.07, b: 0.06, d: 0.055, g: 0.06, tS: 0.09, dZ: 0.085,
  f: 0.085, T: 0.085, s: 0.095, S: 0.095, v: 0.065, D: 0.05, z: 0.075, Z: 0.075,
  h: 0.07, m: 0.07, n: 0.065, N: 0.07, l: 0.06, r: 0.06, w: 0.06, j: 0.055,
};
const UNVOICED = new Set(['p', 't', 'k', 'tS', 'f', 'T', 's', 'S', 'h']);
const DIPHTHONG_SPLIT: Record<string, [string, string]> = {
  AI: ['A', 'I'], aU: ['A', 'U'], EI: ['E', 'I'], OI: ['O', 'I'], '@U': ['@U', 'U'],
};

/**
 * Choral diction: an unstressed schwa sustained on a note is sung as the
 * vowel suggested by the spelling ("om-ni-po-TENT", not "...puh-tuhnt").
 */
export function sungSchwa(text: string): string {
  const t = text.toLowerCase().replace(/[^a-z]/g, '');
  const v = t.match(/[aeiouy]+/)?.[0] ?? '';
  if (v === 'e' || v === 'ea') return 'E';
  if (v === 'i' || v === 'y') return 'I';
  if (v === 'a') return /a[^aeiouy]/.test(t) ? '{' : 'A';
  return 'V';
}

/** First vowel actually sung for a syllable (after choral substitutions). */
function sungVowel(s: TimedSyllable): string {
  const v = s.phon.nucleus.find((p) => MBROLA_VOWELS.has(p)) ?? '@';
  return v === '@' ? sungSchwa(s.text) : v;
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Max pitch points per .pho line. Stock MBROLA reads lines into a 1 KB
 * buffer; our WebAssembly build raises that to 64 KB (see wasm/build.sh).
 * We never split a vowel into repeated phonemes because some voices lack
 * same-vowel diphones (e.g. us3 has no O-O) and would insert silence.
 */
const MAX_POINTS = 2500;

export function buildPho(sylls: TimedSyllable[], opts: Partial<SingOptions> = {}): { pho: string; timing: SungTiming } {
  const o = { ...DEFAULT_SING, ...opts };
  const S = [...sylls].sort((a, b) => a.notes[0].t0 - b.notes[0].t0).map((s) => ({
    ...s,
    notes: s.notes.map((n) => ({ t0: n.t0 + o.leadIn, t1: n.t1 + o.leadIn, midi: n.midi + o.transpose })),
  }));
  const cd = (c: string) => (CONS_DUR[c] ?? 0.06) * o.consonantScale;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  // 1) Consonant placement, boundary by boundary (choral diction):
  //    * every vowel starts exactly on its note's beat and is sustained;
  //    * the closing consonants of a syllable move to the end of its time
  //      slot and are sung together with the next syllable's onset, as one
  //      cluster right before the next beat ("f-o | rth-e | l-o | rdg-o | d-om");
  //    * before a rest, closing consonants are sung on the release (into
  //      the rest) and the next onset just before its entry.
  //    Only when there is too little room is part of a cluster sung after
  //    the beat.
  const segs: Segment[] = [];
  const hzOf = (n: TimedNote) => midiToHz(n.midi);
  const vStart: number[] = new Array(S.length);
  const vEnd: number[] = new Array(S.length);
  const place = (phs: string[], t0: number, k: number, syl: number, kind: Segment['kind'], hz: number) => {
    let t = t0;
    for (const c of phs) {
      const d = cd(c) * k;
      segs.push({ ph: c, t0: t, t1: t + d, syl, kind, pitches: UNVOICED.has(c) ? [] : [[0, hz], [100, hz]] });
      t += d;
    }
    return t;
  };
  for (let i = 0; i <= S.length; i++) {
    const P = i > 0 ? S[i - 1] : null;
    const N = i < S.length ? S[i] : null;
    const pLast = P ? P.notes[P.notes.length - 1] : null;
    const nFirst = N ? N.notes[0] : null;
    const coda = P ? P.phon.coda : [];
    const onset = N ? N.phon.onset : [];
    const codaD = sum(coda.map(cd));
    const onD = sum(onset.map(cd));
    const E = pLast ? pLast.t1 : 0;
    const T = nFirst ? nFirst.t0 : Infinity;
    const legato = !!(P && N && T - E < 0.02);
    // voicing delay of the consonant (or silence) right before N's vowel
    const lastC = onset.length ? onset[onset.length - 1] : legato ? coda[coda.length - 1] : '_';
    const lead = N && lastC ? Math.min(0.25, (o.onsetDelay?.[`${lastC} ${sungVowel(N)}`] ?? 0) / 1000) : 0;
    // room the previous vowel can give up (keeps at least 55% of its last note, ≥ 40 ms of vowel)
    const pRoom = P && pLast ? Math.max(0, Math.min(0.5 * (pLast.t1 - pLast.t0), E - Math.max(vStart[i - 1], pLast.t0) - 0.04)) : 0;
    // After the beat only as a last resort, and never more than 25 ms: a late
    // vowel is heard as the note lagging. Consonants are shortened instead.
    const nRoom = nFirst ? Math.min(0.025, 0.15 * (nFirst.t1 - nFirst.t0)) : 0;
    if (legato) {
      // legato: one cluster (+ the vowel's voicing delay) ending on the next beat
      const D = codaD + onD + lead;
      const before = Math.min(D, pRoom);
      const after = Math.min(D - before, nRoom);
      const k = D > 0 ? (before + after) / D : 1;
      const cs = T - before;
      vEnd[i - 1] = D > 0 ? cs : E;
      const mid = place(coda, cs, k, i - 1, 'coda', hzOf(pLast!));
      vStart[i] = place(onset, mid, k, i, 'onset', hzOf(nFirst!));
      continue;
    }
    let codaEnd = E;
    if (P) {
      // release consonants into the following rest (or the end of the piece)
      const roomAfter = N ? Math.max(0, (T - E) * 0.5) : 0.4;
      const after = Math.min(codaD, roomAfter);
      const before = Math.min(codaD - after, pRoom);
      const k = codaD > 0 ? (after + before) / codaD : 1;
      const cs = E - before;
      vEnd[i - 1] = codaD > 0 ? cs : E;
      codaEnd = place(coda, cs, k, i - 1, 'coda', hzOf(pLast!));
    }
    if (N) {
      const roomBefore = Math.max(0, T - (P ? codaEnd + 0.01 : 0));
      const D = onD + lead;
      const before = Math.min(D, roomBefore);
      const after = Math.min(D - before, nRoom);
      const k = D > 0 ? (before + after) / D : 1;
      vStart[i] = place(onset, T - before, k, i, 'onset', hzOf(nFirst!));
    }
  }
  S.forEach((s, i) => {
    let a = vStart[i];
    let b = vEnd[i];
    if (b - a < 0.03) b = a + 0.03; // pathological crowding
    emitNucleus(segs, s, i, a, b, o);
  });
  segs.sort((x, y) => x.t0 - y.t0);

  // 2) Fill silences, quantize to integer ms boundaries.
  const out: Segment[] = [];
  let t = 0;
  for (const sg of segs) {
    if (sg.t0 > t + 0.0005) out.push({ ph: '_', t0: t, t1: sg.t0, syl: -1, kind: 'rest', pitches: [] });
    out.push({ ...sg, t0: Math.max(sg.t0, t) });
    t = Math.max(t, sg.t1);
  }
  out.push({ ph: '_', t0: t, t1: t + o.tail, syl: -1, kind: 'rest', pitches: [] });

  const lines: string[] = ['; generated by choir-practice singer'];
  let prevMs = 0;
  const final: Segment[] = [];
  for (const sg of out) {
    const endMs = Math.round(sg.t1 * 1000);
    const dur = endMs - prevMs;
    if (dur <= 0) continue;
    const comp = (hz: number) => (o.periodRate > 0 ? o.periodRate / (o.periodRate / hz + 0.5) : hz);
    const pts = sg.pitches.map(([p, hz]) => `${p.toFixed(1)} ${comp(hz).toFixed(2)}`).join(' ');
    lines.push(`${sg.ph} ${dur}${pts ? ' ' + pts : ''}`);
    final.push({ ...sg, t0: prevMs / 1000, t1: endMs / 1000 });
    prevMs = endMs;
  }

  const timing: SungTiming = {
    segments: final,
    duration: prevMs / 1000,
    syllables: S.map((s, i) => {
      const mine = final.filter((g) => g.syl === i);
      const nuc = mine.find((g) => g.kind === 'nucleus');
      return {
        index: s.index,
        text: s.text,
        t0: mine.length ? mine[0].t0 : s.notes[0].t0,
        vowelT0: nuc ? nuc.t0 : s.notes[0].t0,
        t1: mine.length ? mine[mine.length - 1].t1 : s.notes[s.notes.length - 1].t1,
      };
    }),
  };
  return { pho: lines.join('\n') + '\n', timing };
}

function emitNucleus(segs: Segment[], s: TimedSyllable, syl: number, t0: number, t1: number, o: SingOptions) {
  if (t1 - t0 < 0.02) t1 = t0 + 0.02;
  // Expand nucleus into (phoneme, share-of-duration) parts.
  const total = t1 - t0;
  const parts: [string, number][] = [];
  const nuc = s.phon.nucleus.length ? s.phon.nucleus : ['@'];
  const vowels = nuc.filter((p) => MBROLA_VOWELS.has(p));
  nuc.forEach((p, k) => {
    if (!MBROLA_VOWELS.has(p)) { parts.push([p, -1]); return; } // consonant inside merged nucleus
    let share = vowels.length === 1 ? 1 : p === vowels[0] ? 0.7 : 0.3 / (vowels.length - 1);
    // a reduced schwa is barely audible in the diphone voices: always sing a full vowel
    let ph = p === '@' ? sungSchwa(s.text) : p;
    const split = DIPHTHONG_SPLIT[ph];
    const dur = total * share;
    if (split && dur > 0.35) {
      const off = Math.min(0.15, dur * 0.2);
      parts.push([split[0], (dur - off) / total], [split[1], off / total]);
    } else parts.push([ph, share]);
    void k;
  });
  // consonants inside merged nuclei get a fixed slice
  const consSlice = Math.min(0.06, total * 0.15);
  const nCons = parts.filter((p) => p[1] < 0).length;
  const scale = (total - nCons * consSlice) / total;
  let t = t0;
  for (const [ph, share] of parts) {
    const d = share < 0 ? consSlice : share * total * scale;
    segs.push({ ph, t0: t, t1: t + d, syl, kind: 'nucleus', pitches: UNVOICED.has(ph) ? [] : contour(s.notes, t, t + d, o) });
    t += d;
  }
}

/** Pitch contour (Hz) sampled as [pct, Hz] points over [a, b]. */
function contour(notes: TimedNote[], a: number, b: number, o: SingOptions): [number, number][] {
  const times = new Set<number>([a, b]);
  for (let k = 0; k < notes.length; k++) {
    const n = notes[k];
    if (k > 0) {
      const g = Math.min(o.glide, 0.3 * (notes[k - 1].t1 - notes[k - 1].t0), 0.3 * (n.t1 - n.t0));
      times.add(n.t0 - g * 0.4);
      times.add(n.t0 + g * 0.6);
    }
    if (o.vibratoCents > 0) {
      const step = 1 / (o.vibratoRate * 4); // quarter cycles: peaks and zero crossings
      for (let t = n.t0 + o.vibratoDelay; t < n.t1; t += step) times.add(t);
    }
  }
  let ts = [...times].filter((t) => t >= a - 1e-9 && t <= b + 1e-9).sort((x, y) => x - y);
  if (ts.length > MAX_POINTS) {
    const keep = new Set([ts[0], ts[ts.length - 1]]);
    const stride = ts.length / (MAX_POINTS - 2);
    for (let k = 1; k < MAX_POINTS - 1; k++) keep.add(ts[Math.round(k * stride)]);
    ts = [...keep].sort((x, y) => x - y);
  }
  return ts.map((t) => [b > a ? ((t - a) / (b - a)) * 100 : 0, pitchAt(notes, t, o)]);
}

function pitchAt(notes: TimedNote[], t: number, o: SingOptions): number {
  // find note index
  let k = notes.findIndex((n) => t < n.t1);
  if (k < 0) k = notes.length - 1;
  const n = notes[k];
  let cents = n.midi * 100;
  if (k > 0) {
    const prev = notes[k - 1];
    const g = Math.min(o.glide, 0.3 * (prev.t1 - prev.t0), 0.3 * (n.t1 - n.t0));
    const gs = n.t0 - g * 0.4;
    const ge = n.t0 + g * 0.6;
    if (t < ge && g > 0) {
      const x = Math.max(0, Math.min(1, (t - gs) / (ge - gs)));
      const sm = x * x * (3 - 2 * x);
      cents = prev.midi * 100 + (n.midi - prev.midi) * 100 * sm;
    }
  }
  if (k + 1 < notes.length) {
    const nx = notes[k + 1];
    const g = Math.min(o.glide, 0.3 * (n.t1 - n.t0), 0.3 * (nx.t1 - nx.t0));
    if (t > nx.t0 - g * 0.4 && g > 0) {
      const x = Math.max(0, Math.min(1, (t - (nx.t0 - g * 0.4)) / g));
      const sm = x * x * (3 - 2 * x);
      cents = n.midi * 100 + (nx.midi - n.midi) * 100 * sm;
    }
  }
  if (o.vibratoCents > 0) {
    const since = t - n.t0 - o.vibratoDelay;
    if (since > 0) {
      const ramp = Math.min(1, since / 0.25);
      cents += o.vibratoCents * ramp * Math.sin(2 * Math.PI * o.vibratoRate * since);
    }
  }
  return 440 * Math.pow(2, (cents / 100 - 69) / 12);
}
