// Unit tests for the engine stages. Run: npm test
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';
import { alignLine } from '../src/engine/align';
import { practiceTempoMarks } from '../src/engine/catalog';
import { buildStems, mixStems } from '../src/engine/mix';
import type { Mbrola } from '../src/engine/mbrola';
import { createNodeMbrola, onsetDelays } from '../src/engine/mbrola-node';
import { musicXmlText, parseMusicXML } from '../src/engine/musicxml';
import { letterToSound, parseCmuDict, Phonemizer } from '../src/engine/phonemizer';
import { renderVocal } from '../src/engine/render';
import { buildPho, midiToHz, type TimedSyllable } from '../src/engine/singer';
import { TempoMap } from '../src/engine/tempo';
import type { Score } from '../src/engine/types';
import { findRole, singableLines } from '../src/engine/voices';

const xml = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document;
const ph = new Phonemizer(parseCmuDict(readFileSync('assets/dict/cmudict.dict', 'utf8')));

// ---------------------------------------------------------------- fixture
// Synthetic test data (not a real composition): closed score with Soprano
// and Alto sharing one staff, a repeat with 1st/2nd endings and two verses.
const n = (step: string, oct: number, dur: number, voice: number, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>${voice}</voice>${extra}</note>`;
const ly = (t: string, syl = 'single', num = 1) => `<lyric number="${num}"><syllabic>${syl}</syllabic><text>${t}</text></lyric>`;
const FIXTURE = `<?xml version="1.0"?>
<score-partwise version="3.1">
 <work><work-title>Test Fixture</work-title></work>
 <part-list><score-part id="P1"><part-name>Women</part-name></score-part><score-part id="P2"><part-name>Tenor</part-name></score-part></part-list>
 <part id="P1">
  <measure number="1">
   <attributes><divisions>2</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
   <direction><sound tempo="120"/></direction>
   <barline location="left"><repeat direction="forward"/></barline>
   ${n('E', 5, 2, 1, ly('Ve', 'begin') + ly('Glo', 'begin', 2))}${n('F', 5, 2, 1, ly('ni', 'end') + ly('ri', 'middle', 2))}
   <backup><duration>4</duration></backup>
   ${n('C', 5, 4, 2, ly('Come'))}
  </measure>
  <measure number="2">
   <barline location="left"><ending number="1" type="start"/></barline>
   ${n('G', 5, 4, 1, '<tie type="start"/>' + ly('one', 'single') + ly('a', 'end', 2))}
   <backup><duration>4</duration></backup>
   ${n('C', 5, 4, 2, ly('now'))}
   <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
  </measure>
  <measure number="3">
   <barline location="left"><ending number="2" type="start"/></barline>
   ${n('G', 5, 2, 1, ly('glo_and', 'single'))}${n('A', 5, 2, 1)}
   <backup><duration>4</duration></backup>
   ${n('B', 4, 4, 2, ly('end'))}
   <barline location="right"><ending number="2" type="discontinue"/></barline>
  </measure>
  <measure number="4">
   ${n('G', 5, 4, 1, ly('Amen'))}
   <backup><duration>4</duration></backup>
   ${n('C', 5, 4, 2, ly('Amen'))}
  </measure>
 </part>
 <part id="P2">
  <measure number="1"><attributes><divisions>1</divisions><transpose><chromatic>0</chromatic><octave-change>-1</octave-change></transpose></attributes>
   ${n('C', 5, 2, 1, ly('Come'))}</measure>
  <measure number="2">${n('E', 5, 2, 1, ly('now'))}</measure>
  <measure number="3">${n('D', 5, 2, 1, ly('end'))}</measure>
  <measure number="4"><note><chord/></note>${n('C', 5, 1, 1, ly('A', 'begin'))}<note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice></note>${n('C', 5, 1, 1, ly('men', 'end'))}</measure>
 </part>
</score-partwise>`;

describe('MusicXML parsing', () => {
  const score = parseMusicXML(FIXTURE, xml);
  it('expands the repeat with 1st/2nd endings: 1, 2, 1, 3, 4', () => {
    expect(score.measures.map((m) => m.number)).toEqual(['1', '2', '1', '3', '4']);
    expect(score.measures.map((m) => m.srcIndex)).toEqual([0, 1, 0, 2, 3]);
    expect(score.totalQ).toBe(10);
  });
  it('reads tempo, transposition and voices on a shared staff', () => {
    expect(score.tempos[0]).toMatchObject({ startQ: 0, qpm: 120 });
    const women = score.parts[0];
    expect(women.voices.map((v) => v.voice)).toEqual(['1', '2']);
    const tenor = score.parts[1].voices[0];
    expect(tenor.events[0].pitches).toEqual([60]); // written C5, sounds C4
  });
  it('sings verse 2 on the second pass of a repeat', () => {
    const sop = score.parts[0].voices[0];
    const pass2 = sop.events.filter((e) => e.measureIndex === 3).map((e) => e.lyrics[0]?.text);
    expect(pass2).toEqual(['Glo', 'ri']);
    const pass1 = sop.events.filter((e) => e.measureIndex === 1).map((e) => e.lyrics[0]?.text);
    expect(pass1).toEqual(['Ve', 'ni']);
  });
  it('labels lines by role from names and ranges', () => {
    const lines = singableLines(score);
    expect(findRole(lines, 'S')?.line.voice).toBe('1');
    expect(findRole(lines, 'A')?.line.voice).toBe('2');
    expect(findRole(lines, 'T')).toBeTruthy();
    expect(lines.some((l) => l.label.includes('divisi'))).toBe(true); // chord in m.4
  });
  it('reads compressed .mxl files (music21 corpus: Handel, "Lascia ch\'io pianga")', () => {
    const s = parseMusicXML(musicXmlText(readFileSync('tests/fixtures/Lascia_chio_pianga.mxl')), xml);
    const lines = singableLines(s);
    expect(lines.length).toBeGreaterThan(0);
    const sung = alignLine(lines[0].line, { pick: lines[0].pick, verse: 1 });
    // the aria is preceded by its recitative ("Armida dispietata…")
    expect(sung.syllables[0].word.toLowerCase()).toBe('armida');
    const allWords = lines.flatMap((l) => alignLine(l.line, { pick: l.pick, verse: 1 }).syllables.map((x) => x.word.toLowerCase()));
    expect(allWords).toContain('lascia');
  });
});

describe('alignment', () => {
  const score = parseMusicXML(FIXTURE, xml);
  it('groups syllables into words, merges ties, extends melismas', () => {
    const sop = alignLine(score.parts[0].voices[0], { pick: 'top', verse: 1 });
    const words = sop.syllables.map((s) => s.word);
    expect(words.slice(0, 3)).toEqual(['Veni', 'Veni', 'one']);
    // "glo_and" (elision) is followed by a lyric-less A5: a melisma on that syllable
    const glo = sop.syllables.find((s) => s.text === 'glo_and')!;
    expect(glo.notes.map((x) => x.midi)).toEqual([79, 81]);
  });
  it('picks the top or bottom note of a divisi chord', () => {
    const t = score.parts[1].voices[0];
    expect(alignLine(t, { pick: 'top', verse: 1 }).syllables.at(-2)!.notes[0].midi).toBe(64);
    expect(alignLine(t, { pick: 'bottom', verse: 1 }).syllables.at(-2)!.notes[0].midi).toBe(60);
  });
});

describe('phonemizer', () => {
  it('splits Hallelujah onto its four sung syllables (choral diction)', () => {
    const s = ph.syllabify('Hallelujah', ['Hal', 'le', 'lu', 'jah,']);
    expect(s.map((x) => [x.onset.join(''), x.nucleus.join(''), x.coda.join('')])).toEqual([['h', 'A', ''], ['l', 'E', ''], ['l', 'u', ''], ['j', 'A', '']]);
  });
  it('assigns consonant clusters using the hyphenation', () => {
    const s = ph.syllabify('omnipotent', ['om', 'ni', 'po', 'tent']);
    expect(s[0].coda).toEqual(['m']);
    expect(s[1].onset).toEqual(['n']);
    expect(s[3].coda).toEqual(['n', 't']);
    const k = ph.syllabify('kingdom', ['king', 'dom']);
    expect(k[0].coda).toEqual(['N']);
    expect(k[1].onset).toEqual(['d']);
  });
  it('derives archaic forms and falls back to spelling rules', () => {
    expect(ph.candidates('reigneth')[0]).toMatchObject({ source: 'morph', arpabet: ['R', 'EY1', 'N', 'AH0', 'TH'] });
    expect(ph.candidates('zorblat')[0].source).toBe('rule');
    expect(letterToSound('cake')).toBe('K EY1 K');
  });
  it('merges syllables when the word is sung on fewer notes than it has vowels', () => {
    const s = ph.syllabify('glory', ['glory']); // G L AO1 R IY0 sung on one note
    expect(s).toHaveLength(1);
    expect(s[0].nucleus).toEqual(['O', 'r', 'i']);
  });
});

describe('singer timing (choral diction rules)', () => {
  const phon = (t: string[]) => ph.syllabify(t.join(''), t);
  // "Lord God" on two half notes at 60 bpm, then a rest, then "om"
  const [lord] = phon(['Lord']);
  const [god] = phon(['God']);
  const sylls: TimedSyllable[] = [
    { index: 0, text: 'Lord', phon: lord, notes: [{ t0: 1, t1: 2, midi: 50 }] },
    { index: 1, text: 'God', phon: god, notes: [{ t0: 2, t1: 3, midi: 57 }] },
    { index: 2, text: 'om', phon: { onset: [], nucleus: ['A'], coda: ['m'], arpabet: '', source: 'dict' }, notes: [{ t0: 3.5, t1: 4.5, midi: 55 }] },
  ];
  const { timing } = buildPho(sylls, { leadIn: 0 });
  const segs = timing.segments;
  const vowelOf = (i: number) => segs.find((s) => s.syl === i && s.kind === 'nucleus')!;
  it('starts every vowel exactly on its beat', () => {
    expect(vowelOf(0).t0).toBeCloseTo(1, 3);
    expect(vowelOf(1).t0).toBeCloseTo(2, 3);
    expect(vowelOf(2).t0).toBeCloseTo(3.5, 3);
  });
  it('sings the closing consonants right before the next note, with its onset ("l-o rdg-o")', () => {
    const cluster = segs.filter((s) => s.t0 >= vowelOf(0).t1 - 1e-6 && s.t1 <= vowelOf(1).t0 + 1e-6).map((s) => s.ph);
    expect(cluster).toEqual(['r', 'd', 'g']);
    expect(segs.find((s) => s.ph === 'g')!.t1).toBeCloseTo(2, 3);
  });
  it('releases the final consonant into a following rest', () => {
    const d = segs.filter((s) => s.syl === 1 && s.kind === 'coda');
    expect(d[0].t0).toBeCloseTo(3, 3); // vowel of "God" held to the end of its note
  });
  it('holds each note at its exact pitch (no vibrato by default)', () => {
    const p = vowelOf(1).pitches.map(([, hz]) => hz);
    expect(Math.max(...p)).toBeCloseTo(midiToHz(57), 5);
    expect(Math.min(...p)).toBeCloseTo(midiToHz(57), 5);
  });
  it('starts the vowel early by the measured voicing delay of a stop', () => {
    const r = buildPho(sylls, { leadIn: 0, onsetDelay: { 'g A': 60 } });
    const v = r.timing.segments.find((s) => s.syl === 1 && s.kind === 'nucleus')!;
    expect(v.t0).toBeCloseTo(1.94, 3);
  });
});

describe('tempo map', () => {
  it('converts both ways across a tempo change', () => {
    const t = new TempoMap([{ startQ: 0, qpm: 120 }, { startQ: 8, qpm: 60 }], 0.5);
    expect(t.sec(8)).toBeCloseTo(8, 6); // 8 quarters at 60 qpm effective
    expect(t.sec(10)).toBeCloseTo(12, 6);
    expect(t.q(12)).toBeCloseTo(10, 6);
  });
});

describe('Hallelujah, bass part (full pipeline, WebAssembly MBROLA)', () => {
  let score: Score;
  let mb: Mbrola;
  const song = JSON.parse(readFileSync('public/songs/catalog.json', 'utf8')).songs[0];
  beforeAll(async () => {
    score = parseMusicXML(musicXmlText(readFileSync('public/' + song.file)), xml);
    mb = await createNodeMbrola(['us3']);
  });
  const render = () => {
    const line = findRole(singableLines(score), 'B')!;
    return renderVocal(score, mb, ph, { lineKey: line.key, verse: 1, tempoFactor: 1, tempoMarks: practiceTempoMarks(song, score), voice: 'us3', sing: { onsetDelay: onsetDelays('us3') } });
  };
  it('has the full movement with SATB lyrics', () => {
    expect(score.measures).toHaveLength(94);
    const lines = singableLines(score);
    expect(['S', 'A', 'T', 'B'].every((r) => findRole(lines, r as never))).toBe(true);
    expect(findRole(lines, 'B')!.noteCount).toBe(410); // 409 in the source edition + the written-out trill in m.43 (the choir's edition)
  });
  it('renders non-silent audio aligned with the score', () => {
    const r = render();
    expect(r.warnings).toEqual([]);
    expect(r.syllables).toHaveLength(401);
    expect(r.duration).toBeGreaterThan(230);
    let sq = 0;
    for (const s of r.pcm) sq += s * s;
    expect(Math.sqrt(sq / r.pcm.length)).toBeGreaterThan(500); // clearly audible
    // the last syllable ("jah.") ends with the final whole note
    const last = r.syllables.at(-1)!;
    expect(last.text).toBe('jah.');
    expect(last.notes[0].midi).toBe(50);
  });
  it('is reproducible bit for bit', () => {
    const a = render().pcm;
    const b = render().pcm;
    expect(a.length).toBe(b.length);
    expect(a.every((x, i) => x === b[i])).toBe(true);
  });
  it('mixes with accompaniment without clipping', () => {
    const r = render();
    const st = buildStems(score, r, 'full');
    const pcm = mixStems(st, { voice: 1, guide: 0.5, accomp: 1 });
    let peak = 0;
    for (const s of pcm) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeLessThanOrEqual(32767 * 0.98);
    expect(peak).toBeGreaterThan(5000);
  });
});
