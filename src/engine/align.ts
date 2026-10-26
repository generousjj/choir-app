// Note ↔ lyric alignment: turn a voice line into sung syllables.
//
//  * a note with a lyric starts a new syllable;
//  * following notes without a lyric (and no rest in between) extend it as a
//    melisma; tied notes are merged into one longer note;
//  * hyphenation (syllabic begin/middle/end) groups syllables into words so
//    the phonemizer can look the whole word up;
//  * notes with no lyric and nothing to extend are reported (they are sung
//    on a neutral "ah" so the music is complete, and flagged for review).

import type { Lyric, SungLine, SungNote, Syllable, VoiceLine } from './types';
import { pickPitch, type ChordPick } from './voices';

export interface AlignOptions {
  pick: ChordPick;
  verse: number;
}

/** Apply user corrections of lyric text (syllable index → text) and rebuild words. */
export function applyTextOverrides(sung: SungLine, texts: Record<number, string>): SungLine {
  if (!Object.keys(texts).length) return sung;
  const syllables = sung.syllables.map((s) => (texts[s.index] !== undefined ? { ...s, text: texts[s.index] } : { ...s }));
  const byWord = new Map<number, Syllable[]>();
  for (const s of syllables) (byWord.get(s.wordIndex) ?? byWord.set(s.wordIndex, []).get(s.wordIndex)!).push(s);
  for (const g of byWord.values()) {
    const w = g.map((s) => s.text.replace(/[^\p{L}'’_\-\u203f]/gu, '')).join('');
    g.forEach((s) => (s.word = w));
  }
  return { ...sung, syllables };
}

export function lyricFor(lyrics: Lyric[], verse: number): Lyric | undefined {
  if (!lyrics.length) return undefined;
  return lyrics.find((l) => l.verse === verse) ?? [...lyrics].sort((a, b) => a.verse - b.verse)[0];
}

export function alignLine(line: VoiceLine, opts: AlignOptions = { pick: 'top', verse: 1 }): SungLine {
  const syllables: Syllable[] = [];
  const warnings: string[] = [];
  const orphanMeasures = new Set<string>();
  let open: Syllable | null = null;
  let lastEnd = -1;
  let wordIndex = -1;
  let wordOpen = false;
  let wordSyls: Syllable[] = [];

  const closeWord = () => {
    const word = wordSyls.map((s) => s.text.replace(/[^\p{L}'’_\-\u203f]/gu, '')).join('');
    wordSyls.forEach((s, i) => { s.word = word; s.sylInWord = i; s.sylCount = wordSyls.length; });
    wordSyls = [];
    wordOpen = false;
  };

  for (const e of line.events) {
    if (e.grace || e.durQ <= 0) continue;
    const midi = pickPitch(e, opts.pick);
    if (midi === null) { open = null; lastEnd = e.startQ + e.durQ; continue; } // rest
    const contiguous = Math.abs(e.startQ - lastEnd) < 1e-6;
    const note: SungNote = { startQ: e.startQ, durQ: e.durQ, midi, measureIndex: e.measureIndex, measureNumber: e.measureNumber, fermata: e.fermata };
    const ly = lyricFor(e.lyrics, opts.verse);
    lastEnd = e.startQ + e.durQ;

    if (open && contiguous && e.tieStop) {
      const prev = open.notes[open.notes.length - 1];
      if (prev.midi === midi) {
        prev.durQ += e.durQ;
        prev.fermata ||= e.fermata;
        continue;
      }
    }
    if (ly) {
      const continues = ly.syllabic === 'middle' || ly.syllabic === 'end';
      if (!continues || !wordOpen) {
        if (wordOpen) closeWord();
        if (continues) warnings.push(`m.${e.measureNumber}: syllable "${ly.text}" continues a word that never started`);
        wordIndex++;
      }
      const syl: Syllable = { index: syllables.length, text: ly.text, word: '', wordIndex, sylInWord: 0, sylCount: 1, notes: [note] };
      syllables.push(syl);
      wordSyls.push(syl);
      wordOpen = true;
      if (ly.syllabic === 'single' || ly.syllabic === 'end') closeWord();
      open = syl;
      continue;
    }
    if (open && contiguous) {
      open.notes.push(note); // melisma
      continue;
    }
    // orphan note: no lyric and nothing to extend
    orphanMeasures.add(e.measureNumber);
    if (wordOpen) closeWord();
    wordIndex++;
    const syl: Syllable = { index: syllables.length, text: '', word: '', wordIndex, sylInWord: 0, sylCount: 1, notes: [note] };
    syllables.push(syl);
    open = syl;
  }
  if (wordOpen) closeWord();
  if (orphanMeasures.size) warnings.push(`Notes without lyrics (sung on "ah") in measures ${[...orphanMeasures].join(', ')}`);
  return { voiceId: line.id, syllables, unsungNotes: [], warnings };
}
