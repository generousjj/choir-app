// Group sung syllables into display phrases (split at rests) and find the
// syllable sounding at a given time.
import type { TimedSyl } from '../engine/render';

export interface Phrase {
  index: number;
  syls: TimedSyl[];
  t0: number;
  t1: number;
  m0: string;
  m1: string;
  m0Index: number;
  m1Index: number;
}

export function buildPhrases(syls: TimedSyl[], maxSyl = 14): Phrase[] {
  const out: Phrase[] = [];
  let cur: TimedSyl[] = [];
  const flush = () => {
    if (!cur.length) return;
    const last = cur[cur.length - 1];
    out.push({
      index: out.length, syls: cur, t0: cur[0].t0, t1: last.t1,
      m0: cur[0].measureNumber, m1: last.measureNumber,
      m0Index: cur[0].measureIndex, m1Index: last.measureIndex,
    });
    cur = [];
  };
  for (const s of syls) {
    const prev = cur[cur.length - 1];
    const gap = prev ? s.t0 - prev.t1 : 0;
    // break at rests, or before a new word once the line is long
    if (prev && (gap > 0.12 || (cur.length >= maxSyl && s.sylInWord === 0))) flush();
    cur.push(s);
  }
  flush();
  return out;
}

/** Index of the syllable active at time t (its consonants have started), or -1. */
export function syllableAt(syls: TimedSyl[], t: number): number {
  let lo = 0;
  let hi = syls.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (syls[mid].t0 <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function phraseAt(phrases: Phrase[], t: number): number {
  let ans = 0;
  for (const p of phrases) if (p.t0 - 0.6 <= t) ans = p.index;
  return ans;
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

export function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
