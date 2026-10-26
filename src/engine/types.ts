// Core data model shared by every pipeline stage.
//
//   MusicXML ──parse──▶ Score ──extract──▶ VoiceLine ──align──▶ Syllable[]
//        ──phonemize──▶ PhonSyllable[] ──timing──▶ .pho ──MBROLA──▶ PCM
//
// Everything here is plain data (JSON-serialisable) so that a future OMR
// stage can produce the same structures and the review/correction UI can
// edit them directly.

export type Syllabic = 'single' | 'begin' | 'middle' | 'end';

export interface Lyric {
  text: string;
  syllabic: Syllabic;
  /** Lyric extender line (melisma follows). */
  extend?: boolean;
  /** Verse / lyric line number (1-based). */
  verse: number;
}

export interface NoteEvent {
  /** Onset in quarter notes from the start of the piece. */
  startQ: number;
  durQ: number;
  /** MIDI pitches sounding in this event (several = chord/divisi). Empty = rest. */
  pitches: number[];
  tieStart?: boolean;
  tieStop?: boolean;
  /** Lyrics attached to this event, one per verse. */
  lyrics: Lyric[];
  /** 1-based index into Score.measures. */
  measureIndex: number;
  /** Notated measure number (as printed). */
  measureNumber: string;
  fermata?: boolean;
  /** Grace notes have durQ 0 and are ignored by the singer. */
  grace?: boolean;
}

export interface VoiceLine {
  /** Stable id: `${partId}/s${staff}/v${voice}` */
  id: string;
  partId: string;
  partName: string;
  staff: number;
  voice: string;
  events: NoteEvent[];
}

export interface Part {
  id: string;
  name: string;
  /** Raw MusicXML <score-part> index, for display filtering (sheet music). */
  index: number;
  voices: VoiceLine[];
}

export interface MeasureInfo {
  index: number; // 1-based
  number: string; // printed number
  startQ: number;
  durQ: number;
  timeSig: [number, number];
  /** 0-based index of the written measure (differs from index-1 when repeats are expanded). */
  srcIndex: number;
}

export interface TempoMark {
  startQ: number;
  /** Quarter notes per minute. */
  qpm: number;
  text?: string;
}

export interface Score {
  title: string;
  composer: string;
  parts: Part[];
  measures: MeasureInfo[];
  tempos: TempoMark[];
  totalQ: number;
  /** Diagnostics produced while parsing (shown in the review screen). */
  warnings: string[];
}

/** One sung syllable, possibly spanning several notes (melisma / ties). */
export interface Syllable {
  /** Index in the line. */
  index: number;
  text: string;
  /** Full word this syllable belongs to (hyphenation joined). */
  word: string;
  wordIndex: number;
  /** Position of this syllable inside its word. */
  sylInWord: number;
  sylCount: number;
  notes: SungNote[];
  /** A user override of the pronunciation (ARPAbet, space separated). */
  pronOverride?: string;
}

export interface SungNote {
  startQ: number;
  durQ: number;
  midi: number;
  measureIndex: number;
  measureNumber: string;
  fermata?: boolean;
}

/** A gap in the sung line (rest or note without lyric that is not a melisma). */
export interface RestSpan {
  startQ: number;
  durQ: number;
}

export interface SungLine {
  voiceId: string;
  syllables: Syllable[];
  /** Notes that carried no lyric and could not be attached to one. */
  unsungNotes: SungNote[];
  warnings: string[];
}

/** Phonemes of one syllable, already in the target (MBROLA) alphabet. */
export interface PhonSyllable {
  onset: string[];
  nucleus: string[];
  coda: string[];
  /** ARPAbet used, for display/correction. */
  arpabet: string;
  /** Where the pronunciation came from. */
  source: 'dict' | 'diction' | 'rule' | 'override' | 'morph';
}
