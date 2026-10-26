// Sung syllables → phonemes, word by word (handles elisions "glo-ry_and").
import { Phonemizer } from './phonemizer';
import type { PhonSyllable, Syllable } from './types';

/** Word breaks inside one lyric: undertie/underscore elision, "jah,Hal", "the Lord". */
const ELISION = /[_‿⁀]+|(?<=\p{L}[,;:!?.]+)(?=\p{L})|\s+/u;

export function phonetize(syls: Syllable[], ph: Phonemizer, overrides: Record<number, string> = {}): PhonSyllable[] {
  const out: PhonSyllable[] = new Array(syls.length);
  // group by word
  const words = new Map<number, Syllable[]>();
  for (const s of syls) (words.get(s.wordIndex) ?? words.set(s.wordIndex, []).get(s.wordIndex)!).push(s);
  for (const group of words.values()) {
    if (group.length === 1 && !group[0].text.trim()) {
      out[group[0].index] = { onset: [], nucleus: ['A'], coda: [], arpabet: 'AA1', source: 'rule' }; // lyric-less note
      continue;
    }
    // split into sub-words at elisions; pieces[k] = list of [sylIndex, text]
    const pieces: [number, string][][] = [[]];
    for (const s of group) {
      const parts = s.text.split(ELISION);
      parts.forEach((p, i) => {
        if (i > 0) pieces.push([]);
        pieces[pieces.length - 1].push([s.index, p]);
      });
    }
    const merged = new Map<number, PhonSyllable>();
    for (const piece of pieces) {
      const texts = piece.map(([, t]) => t);
      const word = texts.map((t) => t.replace(/[^\p{L}'’]/gu, '')).join('');
      // A user override applies to a whole word, stored on its first syllable
      const ov = piece.length === group.length ? overrides[piece[0][0]] : undefined;
      const res = ph.syllabify(word || 'ah', texts, ov);
      piece.forEach(([idx], k) => {
        const r = res[k];
        const prev = merged.get(idx);
        if (!prev) merged.set(idx, r);
        else merged.set(idx, {
          onset: prev.onset,
          nucleus: [...prev.nucleus, ...prev.coda, ...r.onset, ...r.nucleus],
          coda: r.coda,
          arpabet: `${prev.arpabet} | ${r.arpabet}`,
          source: prev.source,
        });
      });
    }
    for (const [i, p] of merged) out[i] = p;
  }
  return out;
}
