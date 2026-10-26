// English phonemizer for singing.
//
//  1. Grapheme→phoneme: CMU Pronouncing Dictionary (ARPAbet) with a choral
//     diction lexicon on top, archaic-morphology fallbacks (-eth, -est, ’d)
//     and finally letter-to-sound rules for out-of-vocabulary words.
//  2. Syllabification: the score already tells us how a word is split into
//     sung syllables ("Hal-le-lu-jah"); we map the dictionary phonemes onto
//     those syllables (one vowel nucleus per sung syllable, consonant clusters
//     split using the spelling at the hyphen).
//  3. ARPAbet → MBROLA us1/us2/us3 SAMPA alphabet.

import type { PhonSyllable } from './types';

export type Dict = Map<string, string[]>;

/** Parse cmudict.dict text ("word PH1 PH2 ..." with "word(2)" variants). */
export function parseCmuDict(text: string): Dict {
  const d: Dict = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(';;;')) continue;
    const hash = line.indexOf('#');
    const clean = (hash >= 0 ? line.slice(0, hash) : line).trim();
    const sp = clean.indexOf(' ');
    if (sp < 0) continue;
    const word = clean.slice(0, sp).replace(/\(\d+\)$/, '');
    const pron = clean.slice(sp + 1).trim();
    const list = d.get(word);
    if (list) list.push(pron);
    else d.set(word, [pron]);
  }
  return d;
}

/**
 * Choral diction lexicon. These take precedence over CMUdict because sung
 * English differs from spoken English (pure vowels, no reduced schwas on
 * sustained notes, conventional church Latin/Hebrew words).
 */
export const DICTION: Record<string, string> = {
  hallelujah: 'HH AA2 L EH0 L UW1 Y AA0',
  alleluia: 'AA2 L EH0 L UW1 Y AA0',
  amen: 'AA1 M EH1 N',
  and: 'AA1 N D', // choral "ahnd": the bare [æ] onset is often heard as "then"/"than"
  gloria: 'G L AO1 R IY0 AA0',
  hosanna: 'HH OW0 Z AA1 N AA0',
  noel: 'N OW0 EH1 L',
  emmanuel: 'EH0 M AE1 N Y UW0 EH2 L',
  excelsis: 'EH0 K S EH1 L S IY0 S',
  deo: 'D EH1 OW0',
  "o'er": 'OW1 R',
  "e'er": 'EH1 R',
  "ne'er": 'N EH1 R',
  "ev'ry": 'EH1 V R IY0',
  "heav'n": 'HH EH1 V N',
  "pow'r": 'P AW1 R',
  "'tis": 'T IH1 Z',
  "'twas": 'T W AH1 Z',
  thee: 'DH IY1',
  thou: 'DH AW1',
  thy: 'DH AY1',
  thine: 'DH AY1 N',
  ye: 'Y IY1',
  // "the" before consonants: short schwa (lengthened notes become "thuh")
  the: 'DH AH0',
  a: 'AH0',
};

const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

export const isArpaVowel = (p: string) => VOWELS.has(p.replace(/\d/g, ''));

/** ARPAbet → MBROLA us voice phoneme names (verified against us1/us2/us3). */
const ARPA_TO_MBROLA: Record<string, string> = {
  AA: 'A', AE: '{', AO: 'O', AW: 'aU', AY: 'AI', EH: 'E', ER: 'r=', EY: 'EI',
  IH: 'I', IY: 'i', OW: '@U', OY: 'OI', UH: 'U', UW: 'u',
  B: 'b', CH: 'tS', D: 'd', DH: 'D', F: 'f', G: 'g', HH: 'h', JH: 'dZ', K: 'k',
  L: 'l', M: 'm', N: 'n', NG: 'N', P: 'p', R: 'r', S: 's', SH: 'S', T: 't',
  TH: 'T', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'Z',
};

export function arpaToMbrola(p: string): string {
  const base = p.replace(/\d/g, '');
  if (base === 'AH') return /[12]/.test(p) ? 'V' : '@';
  const m = ARPA_TO_MBROLA[base];
  if (!m) throw new Error(`No MBROLA mapping for ARPAbet phoneme ${p}`);
  return m;
}

export const MBROLA_VOWELS = new Set(['i', 'I', 'E', '{', 'A', 'O', 'U', 'u', 'V', '@', 'r=', 'AI', 'aU', 'OI', 'EI', '@U']);

/** Lowercase a lyric fragment and drop punctuation (keeps inner apostrophes). */
export function normalizeWord(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // noël → noel, née → nee
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z']/g, '')
    .replace(/^'+(?!tis|twas)/, '')
    .replace(/'+$/, '');
}

// ---------------------------------------------------------------------------
// Letter-to-sound fallback (simplified English spelling rules). Only used
// for words missing from CMUdict; the review screen lets the user override.

const LTS_MULTI: [string, string][] = [
  ['tion', 'SH AH0 N'], ['sion', 'ZH AH0 N'], ['ough', 'AO1'], ['eigh', 'EY1'],
  ['igh', 'AY1'], ['tch', 'CH'], ['dge', 'JH'],
  ['ph', 'F'], ['th', 'TH'], ['sh', 'SH'], ['ch', 'CH'], ['ck', 'K'], ['ng', 'NG'],
  ['qu', 'K W'], ['wh', 'W'], ['kn', 'N'], ['wr', 'R'], ['gh', ''],
  ['ee', 'IY1'], ['ea', 'IY1'], ['oo', 'UW1'], ['ou', 'AW1'], ['ow', 'OW1'],
  ['oa', 'OW1'], ['ai', 'EY1'], ['ay', 'EY1'], ['oi', 'OY1'], ['oy', 'OY1'],
  ['au', 'AO1'], ['aw', 'AO1'], ['ie', 'IY1'], ['ei', 'EY1'], ['ue', 'UW1'], ['ew', 'UW1'],
  ['er', 'ER0'], ['ir', 'ER1'], ['ur', 'ER1'], ['ar', 'AA1 R'], ['or', 'AO1 R'],
];
const LTS_SHORT: Record<string, string> = { a: 'AE1', e: 'EH1', i: 'IH1', o: 'AA1', u: 'AH1', y: 'IH1' };
const LTS_LONG: Record<string, string> = { a: 'EY1', e: 'IY1', i: 'AY1', o: 'OW1', u: 'UW1', y: 'AY1' };
const LTS_CONS: Record<string, string> = {
  b: 'B', d: 'D', f: 'F', h: 'HH', j: 'JH', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P',
  r: 'R', s: 'S', t: 'T', v: 'V', w: 'W', x: 'K S', z: 'Z',
};
const isVowelLetter = (c: string | undefined) => !!c && 'aeiou'.includes(c);

export function letterToSound(word: string): string {
  const w = word.replace(/'/g, '');
  const out: string[] = [];
  let i = 0;
  while (i < w.length) {
    const rest = w.slice(i);
    const multi = LTS_MULTI.find(([g]) => rest.startsWith(g));
    if (multi) {
      if (multi[1]) out.push(multi[1]);
      i += multi[0].length;
      continue;
    }
    const c = w[i];
    const next = w[i + 1];
    if (c === next && !isVowelLetter(c)) { i++; continue; } // doubled consonant
    if (c === 'e' && i === w.length - 1 && out.some(isArpaVowelGroup)) { i++; continue; } // silent final e
    if ('aeiouy'.includes(c)) {
      if (c === 'y' && i === 0) { out.push('Y'); i++; continue; }
      if (c === 'y' && i === w.length - 1) { out.push(out.some(isArpaVowelGroup) ? 'IY0' : 'AY1'); i++; continue; }
      // magic e: V C e#
      const magic = !isVowelLetter(next) && next !== undefined && w[i + 2] === 'e' && i + 3 === w.length;
      out.push(magic ? LTS_LONG[c] : LTS_SHORT[c]);
      i++;
      continue;
    }
    if (c === 'c') { out.push('eiy'.includes(next ?? '') ? 'S' : 'K'); i++; continue; }
    if (c === 'g') { out.push('eiy'.includes(next ?? '') ? 'JH' : 'G'); i++; continue; }
    if (c === 's' && i === w.length - 1 && i > 0 && !'ptkf'.includes(w[i - 1])) { out.push('Z'); i++; continue; }
    const m = LTS_CONS[c];
    if (m) out.push(m);
    i++;
  }
  const pron = out.join(' ').trim();
  return pron || 'AH0';
}
const isArpaVowelGroup = (g: string) => g.split(' ').some(isArpaVowel);

// ---------------------------------------------------------------------------

export interface Pronunciation {
  arpabet: string[];
  source: PhonSyllable['source'];
}

export class Phonemizer {
  constructor(private dict: Dict, private diction: Record<string, string> = DICTION, private userLexicon: Record<string, string> = {}) {}

  setUserLexicon(lex: Record<string, string>) {
    this.userLexicon = lex;
  }

  /** All candidate pronunciations of a word, best first. */
  candidates(rawWord: string): Pronunciation[] {
    const w = normalizeWord(rawWord);
    if (!w) return [];
    const res: Pronunciation[] = [];
    const push = (p: string, source: Pronunciation['source']) => {
      const ph = p.trim().split(/\s+/);
      if (!res.some((r) => r.arpabet.join(' ') === ph.join(' '))) res.push({ arpabet: ph, source });
    };
    if (this.userLexicon[w]) push(this.userLexicon[w], 'override');
    if (this.diction[w]) push(this.diction[w], 'diction');
    for (const p of this.dict.get(w) ?? []) push(p, 'dict');
    if (res.length) return res;
    const morph = this.morphology(w);
    if (morph) return [{ arpabet: morph.split(' '), source: 'morph' }];
    return [{ arpabet: letterToSound(w).split(' '), source: 'rule' }];
  }

  private lookup(w: string): string | undefined {
    return this.userLexicon[w] ?? this.diction[w] ?? this.dict.get(w)?.[0];
  }

  /** Archaic / poetic forms common in sacred texts. */
  private morphology(w: string): string | undefined {
    const tryBases = (stem: string): string | undefined => {
      const cands = [stem, stem + 'e'];
      if (/(.)\1$/.test(stem)) cands.push(stem.slice(0, -1)); // setteth → set
      if (stem.endsWith('i')) cands.push(stem.slice(0, -1) + 'y'); // crieth → cry
      for (const c of cands) {
        const p = this.lookup(c);
        if (p) return p;
      }
      return undefined;
    };
    for (const [suf, add] of [['eth', 'AH0 TH'], ['est', 'AH0 S T'], ["'st", 'S T'], ["'d", 'D'], ["'s", 'Z'], ['s', 'Z'], ['ed', 'D']] as const) {
      if (w.endsWith(suf) && w.length > suf.length + 1) {
        const base = tryBases(w.slice(0, -suf.length));
        if (base) return `${base} ${add}`;
      }
    }
    return undefined;
  }

  /**
   * Phonemize one word and distribute its phonemes over the sung syllables.
   * `sylTexts` are the lyric fragments as printed ("Hal", "le", "lu", "jah,").
   */
  syllabify(word: string, sylTexts: string[], override?: string): PhonSyllable[] {
    const n = sylTexts.length;
    let cands = this.candidates(word);
    if (override) cands = [{ arpabet: override.trim().split(/\s+/), source: 'override' }];
    if (!cands.length) return sylTexts.map(() => ({ onset: [], nucleus: ['@'], coda: [], arpabet: '', source: 'rule' }));
    // Prefer a candidate whose vowel count equals the sung syllable count.
    const vc = (p: Pronunciation) => p.arpabet.filter(isArpaVowel).length;
    const exact = cands.find((c) => vc(c) === n);
    const chosen = exact ?? cands.find((c) => vc(c) > n) ?? cands[0];
    if (vc(chosen) < n) {
      // The score splits the word into more syllables than the dictionary
      // has vowels (e.g. "ev-'ry-bo-dy" vs "EH V R IY ..."): phonemize each
      // fragment on its own so every note still gets a vowel.
      return sylTexts.map((t) => {
        const p = letterToSound(normalizeWord(t) || 'a').split(' ');
        const parts = splitPhones(p, [t]);
        return { ...parts[0], arpabet: p.join(' '), source: 'rule' as const };
      });
    }
    return splitPhones(chosen.arpabet, sylTexts).map((s) => ({ ...s, arpabet: chosen.arpabet.join(' '), source: chosen.source }));
  }
}

/** Distribute ARPAbet phones over n sung syllables (n ≤ vowel count). */
export function splitPhones(arpa: string[], sylTexts: string[]): Omit<PhonSyllable, 'arpabet' | 'source'>[] {
  const n = sylTexts.length;
  // Nucleus groups: indices of vowels; merge until we have n groups.
  let groups: number[][] = arpa.map((p, i) => (isArpaVowel(p) ? [i] : null)).filter((g): g is number[] => g !== null);
  if (groups.length === 0) groups = [[arpa.length]]; // no vowel at all; synthesize a schwa
  while (groups.length > n) {
    // merge the adjacent pair with the fewest consonants between them, preferring later pairs
    let best = 0;
    let bestGap = Infinity;
    for (let k = 0; k < groups.length - 1; k++) {
      const gap = groups[k + 1][0] - groups[k][groups[k].length - 1] - 1;
      if (gap <= bestGap) { bestGap = gap; best = k; }
    }
    groups.splice(best, 2, [...groups[best], ...groups[best + 1]]);
  }
  const mb = (i: number) => arpaToMbrola(arpa[i]);
  const result = groups.map(() => ({ onset: [] as string[], nucleus: [] as string[], coda: [] as string[] }));
  groups.forEach((g, k) => {
    // nucleus = vowels in group (consonants between merged vowels are kept in order)
    for (let i = g[0]; i <= g[g.length - 1]; i++) if (i < arpa.length) result[k].nucleus.push(mb(i));
    if (g[0] >= arpa.length) result[k].nucleus.push('@');
  });
  // leading consonants
  for (let i = 0; i < groups[0][0] && i < arpa.length; i++) result[0].onset.push(mb(i));
  // trailing consonants
  const lastG = groups[groups.length - 1];
  for (let i = lastG[lastG.length - 1] + 1; i < arpa.length; i++) result[groups.length - 1].coda.push(mb(i));
  // clusters between groups
  for (let k = 0; k < groups.length - 1; k++) {
    const from = groups[k][groups[k].length - 1] + 1;
    const to = groups[k + 1][0];
    const cluster = arpa.slice(from, to).map(arpaToMbrola);
    const nCoda = codaCount(cluster.length, sylTexts[k] ?? '', sylTexts[k + 1] ?? '');
    result[k].coda.push(...cluster.slice(0, nCoda));
    result[k + 1].onset.push(...cluster.slice(nCoda));
  }
  return result;
}

function codaCount(m: number, cur: string, next: string): number {
  if (m === 0) return 0;
  const c = normalizeWord(cur);
  const nx = normalizeWord(next);
  if (isVowelLetter(nx[0])) return m; // "ev-er": V goes with "ev"
  if (!c || /[aeiouy]$/.test(c)) return 0; // open syllable: "le-lu"
  if (m === 1) return 0; // legato singing carries single consonants forward
  const tc = (c.match(/[^aeiouy]+$/)?.[0].length ?? 0) || 1;
  const lc = (nx.match(/^[^aeiouy]+/)?.[0].length ?? 0) || 1;
  return Math.min(m - 1, Math.max(1, Math.round((m * tc) / (tc + lc))));
}
