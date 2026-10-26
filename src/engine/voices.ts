// Voice extraction: find the sung lines in a score and label them S/A/T/B.
//
// Choral scores come in many layouts:
//   * open score: one part per voice (Soprano, Alto, Tenor, Bass) — easy;
//   * closed score: SA on one staff (voice 1 / voice 2), TB on another;
//   * divisi written as chords inside one voice (e.g. Baritone/Bass split).
// We expose every (part, staff, voice) line that carries lyrics, plus
// "divisi" selectors (top / bottom note of chords) when chords occur.

import type { NoteEvent, Score, VoiceLine } from './types';

export type Role = 'S' | 'A' | 'T' | 'B' | 'other';
export type ChordPick = 'top' | 'bottom' | number;

export interface SingableLine {
  key: string; // `${voiceLineId}|${pick}`
  line: VoiceLine;
  pick: ChordPick;
  label: string;
  role: Role;
  lyricCount: number;
  noteCount: number;
  range: [number, number];
}

const ROLE_PATTERNS: [Role, RegExp][] = [
  ['S', /\b(sop|soprano|treble|cantus|desc)/i],
  ['A', /\b(alt|alto|contralto|mezzo)/i],
  ['T', /\b(ten|tenor|tenore)/i],
  ['B', /\b(bass|basso|bar|baritone|bari)/i],
];

export function roleFromName(name: string): Role | null {
  for (const [r, re] of ROLE_PATTERNS) if (re.test(name)) return r;
  return null;
}

function roleFromRange(lo: number, hi: number): Role {
  const mid = (lo + hi) / 2;
  if (mid >= 67) return 'S';
  if (mid >= 61) return 'A';
  if (mid >= 55) return 'T';
  return 'B';
}

export function pickPitch(e: NoteEvent, pick: ChordPick): number | null {
  if (!e.pitches.length) return null;
  const sorted = [...e.pitches].sort((a, b) => a - b);
  if (pick === 'top') return sorted[sorted.length - 1];
  if (pick === 'bottom') return sorted[0];
  return sorted[Math.min(pick, sorted.length - 1)];
}

const meanPitch = (l: VoiceLine) => {
  const ps = l.events.flatMap((e) => e.pitches);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
};

/**
 * Closed score: lines sharing a staff are ranked by register: the upper one
 * is S (women's staff) or T (men's), the lower A or B. The staff's overall
 * register decides between the women's and men's pair.
 */
function sharedStaffRoles(part: Score['parts'][number]): Map<string, Role> {
  const roles = new Map<string, Role>();
  const byStaff = new Map<number, VoiceLine[]>();
  for (const v of part.voices) if (v.events.some((e) => e.lyrics.length)) (byStaff.get(v.staff) ?? byStaff.set(v.staff, []).get(v.staff)!).push(v);
  for (const vs of byStaff.values()) {
    if (vs.length < 2) continue;
    const sorted = [...vs].sort((a, b) => meanPitch(b) - meanPitch(a));
    const mean = sorted.reduce((a, v) => a + meanPitch(v), 0) / sorted.length;
    const [hi, lo]: Role[] = mean >= 60 ? ['S', 'A'] : ['T', 'B'];
    sorted.forEach((v, i) => roles.set(v.id, i === 0 ? hi : lo));
  }
  return roles;
}

export function singableLines(score: Score): SingableLine[] {
  const out: SingableLine[] = [];
  for (const part of score.parts) {
    const shared = sharedStaffRoles(part);
    for (const line of part.voices) {
      const notes = line.events.filter((e) => e.pitches.length && !e.grace);
      const lyricCount = line.events.filter((e) => e.lyrics.length).length;
      if (!notes.length || lyricCount === 0) continue;
      const hasChords = notes.some((e) => e.pitches.length > 1);
      const multiVoice = part.voices.filter((v) => v.events.some((e) => e.lyrics.length)).length > 1;
      const picks: ChordPick[] = hasChords ? ['top', 'bottom'] : ['top'];
      for (const pick of picks) {
        const ps = notes.map((e) => pickPitch(e, pick)!);
        const lo = Math.min(...ps);
        const hi = Math.max(...ps);
        // shared staff → relative role; otherwise the part name (divisi notes keep it); else the range
        const role = shared.get(line.id) ?? roleFromName(part.name) ?? roleFromRange(lo, hi);
        let label = part.name || line.partId;
        if (multiVoice) label += ` (staff ${line.staff}, voice ${line.voice})`;
        if (hasChords && role === 'B' && !multiVoice && /bass|men/i.test(part.name)) label = pick === 'top' ? 'Baritone (upper note at divisi)' : 'Bass (lower note at divisi)';
        else if (hasChords) label += pick === 'top' ? ' — upper divisi' : ' — lower divisi';
        out.push({ key: `${line.id}|${pick}`, line, pick, label, role, lyricCount, noteCount: notes.length, range: [lo, hi] });
      }
    }
  }
  return out;
}

/** Best line for a requested role (e.g. 'B' for a baritone). */
export function findRole(lines: SingableLine[], role: Role): SingableLine | undefined {
  const named = lines.filter((l) => l.role === role);
  if (named.length) return named.sort((a, b) => b.lyricCount - a.lyricCount)[0];
  return undefined;
}

/** Instrumental / non-lyric lines usable as accompaniment. */
export function accompanimentLines(score: Score, exclude: VoiceLine[]): VoiceLine[] {
  const ex = new Set(exclude.map((l) => l.id));
  return score.parts.flatMap((p) => p.voices).filter((v) => !ex.has(v.id) && v.events.some((e) => e.pitches.length));
}
