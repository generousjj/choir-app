// End-to-end vocal rendering: Score + chosen line → PCM + timing map.
import { alignLine, applyTextOverrides } from './align';
import type { Mbrola } from './mbrola';
import { phonetize } from './phonetize';
import type { Phonemizer } from './phonemizer';
import { buildPho, DEFAULT_SING, type SingOptions, type TimedSyllable } from './singer';
import { TempoMap } from './tempo';
import type { PhonSyllable, Score, SungLine, TempoMark } from './types';
import { singableLines, type SingableLine } from './voices';

export interface RenderOptions {
  lineKey: string;
  verse: number;
  /** 1 = written/practice tempo, 0.5 = half speed. */
  tempoFactor: number;
  /** Tempo marks to use instead of the score's (song-level practice tempo). */
  tempoMarks?: TempoMark[];
  defaultQpm?: number;
  voice: string;
  sing?: Partial<SingOptions>;
  /** Pronunciation overrides: first-syllable index of a word → ARPAbet. */
  overrides?: Record<number, string>;
  /** Corrected lyric text: syllable index → text. */
  textOverrides?: Record<number, string>;
}

export interface TimedSyl {
  index: number;
  text: string;
  word: string;
  wordIndex: number;
  sylInWord: number;
  measureIndex: number;
  measureNumber: string;
  /** audio times (s): consonant start, vowel start (= the beat), end */
  t0: number;
  vowelT0: number;
  t1: number;
  notes: { t0: number; t1: number; midi: number }[];
  phon: PhonSyllable;
}

export interface VocalRender {
  pcm: Int16Array;
  sampleRate: number;
  leadIn: number;
  duration: number;
  syllables: TimedSyl[];
  measures: { index: number; number: string; t: number; q: number }[];
  tempo: TempoMap;
  line: SingableLine;
  sung: SungLine;
  pho: string;
  warnings: string[];
}

export function tempoMapFor(score: Score, opts: Pick<RenderOptions, 'tempoMarks' | 'tempoFactor' | 'defaultQpm'>) {
  return new TempoMap(opts.tempoMarks ?? score.tempos, opts.tempoFactor, opts.defaultQpm ?? 100);
}

export function renderVocal(score: Score, mbrola: Mbrola, ph: Phonemizer, opts: RenderOptions): VocalRender {
  const line = singableLines(score).find((l) => l.key === opts.lineKey);
  if (!line) throw new Error(`Voice line ${opts.lineKey} not found`);
  const sung = applyTextOverrides(alignLine(line.line, { pick: line.pick, verse: opts.verse }), opts.textOverrides ?? {});
  const phon = phonetize(sung.syllables, ph, opts.overrides);
  const tempo = tempoMapFor(score, opts);
  const sing = { ...DEFAULT_SING, ...opts.sing };
  const timed: TimedSyllable[] = sung.syllables.map((s, i) => ({
    index: i,
    text: s.text,
    phon: phon[i],
    notes: s.notes.map((n) => ({ t0: tempo.sec(n.startQ), t1: tempo.sec(n.startQ + n.durQ), midi: n.midi })),
  }));
  const { pho, timing } = buildPho(timed, sing);
  const res = mbrola.synth(pho, opts.voice);
  const lead = sing.leadIn;
  const syllables: TimedSyl[] = sung.syllables.map((s, i) => {
    const t = timing.syllables[i];
    return {
      index: i, text: s.text, word: s.word, wordIndex: s.wordIndex, sylInWord: s.sylInWord,
      measureIndex: s.notes[0].measureIndex, measureNumber: s.notes[0].measureNumber,
      t0: t.t0, vowelT0: t.vowelT0, t1: t.t1,
      notes: timed[i].notes.map((n) => ({ t0: n.t0 + lead, t1: n.t1 + lead, midi: n.midi + sing.transpose })),
      phon: phon[i],
    };
  });
  const measures = score.measures.map((m) => ({ index: m.index, number: m.number, q: m.startQ, t: tempo.sec(m.startQ) + lead }));
  const warnings = [...score.warnings, ...sung.warnings, ...res.warnings.map((w) => `Synthesizer: ${w}`)];
  return { pcm: res.pcm, sampleRate: res.sampleRate, leadIn: lead, duration: res.pcm.length / res.sampleRate, syllables, measures, tempo, line, sung, pho, warnings };
}
