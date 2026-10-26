import type { Score, TempoMark } from './types';

export interface SongEntry {
  id: string;
  title: string;
  subtitle?: string;
  composer?: string;
  file: string;
  practiceTempo?: { measure: number; qpm: number; text?: string }[];
  source?: string;
  license?: string;
  /** Song-specific pronunciations (word → ARPAbet), e.g. a French refrain. */
  lexicon?: Record<string, string>;
  /** imported by the user (stored in the browser) */
  user?: boolean;
}

/** Convert a song's measure-based practice tempo into quarter-note tempo marks. */
export function practiceTempoMarks(song: SongEntry | undefined, score: Score): TempoMark[] | undefined {
  if (!song?.practiceTempo?.length) return undefined;
  return song.practiceTempo.map((t) => {
    const m = score.measures.find((x) => x.number === String(t.measure)) ?? score.measures[Math.max(0, t.measure - 1)];
    return { startQ: m ? m.startQ : 0, qpm: t.qpm, text: t.text };
  });
}
