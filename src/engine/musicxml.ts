// MusicXML (score-partwise) → Score.
//
// Works on any DOM implementation (browser DOMParser, @xmldom/xmldom in Node).
// Handles: divisions, chords, multiple voices/staves, backup/forward, ties,
// <transpose>, grace notes, lyrics (verses, syllabic, elision, extend),
// fermatas, tempo (<sound tempo>, <metronome>), repeats and voltas (expanded,
// with verse n sung on the n-th pass), pickup measures.

import { unzipSync, strFromU8 } from 'fflate';
import type { Lyric, MeasureInfo, NoteEvent, Part, Score, Syllabic, TempoMark, VoiceLine } from './types';

type El = Element;
export type XmlParser = (text: string) => Document;

const kids = (e: El | Document, name?: string): El[] => {
  const out: El[] = [];
  const cn = (e as El).childNodes;
  for (let i = 0; i < cn.length; i++) {
    const n = cn[i] as El;
    if (n.nodeType === 1 && (!name || n.nodeName === name)) out.push(n);
  }
  return out;
};
const kid = (e: El, name: string): El | undefined => kids(e, name)[0];
const txt = (e: El | undefined): string => (e?.textContent ?? '').trim();
const num = (e: El | undefined, d = 0): number => {
  const v = parseFloat(txt(e));
  return Number.isFinite(v) ? v : d;
};

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Read a .mxl (zip) or plain MusicXML file into XML text. */
export function musicXmlText(data: Uint8Array): string {
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const files = unzipSync(data);
    const container = files['META-INF/container.xml'];
    let path: string | undefined;
    if (container) path = /full-path="([^"]+)"/.exec(strFromU8(container))?.[1];
    if (!path) path = Object.keys(files).find((f) => /\.(musicxml|xml)$/i.test(f) && !f.startsWith('META-INF'));
    if (!path || !files[path]) throw new Error('No MusicXML score found inside .mxl archive');
    return strFromU8(files[path]);
  }
  // UTF-16 BOM support
  if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) {
    return new TextDecoder(data[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(data);
  }
  return new TextDecoder('utf-8').decode(data);
}

interface RawEvent {
  offQ: number;
  durQ: number;
  pitches: number[];
  voice: string;
  staff: number;
  tieStart: boolean;
  tieStop: boolean;
  lyrics: Lyric[];
  fermata: boolean;
  grace: boolean;
  rest: boolean;
}

interface RawMeasure {
  number: string;
  lenQ: number; // actual content length (max over parts)
  timeSig: [number, number];
  repeatForward: boolean;
  repeatBackward: number; // times (0 = none)
  endings: number[]; // volta numbers this measure belongs to
  tempos: { offQ: number; qpm: number; text?: string }[];
  implicit: boolean;
}

export function parseMusicXML(xml: string, parseXml: XmlParser): Score {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (!root) throw new Error('Empty XML document');
  if (root.nodeName === 'score-timewise') throw new Error('score-timewise MusicXML is not supported yet; please export as partwise');
  if (root.nodeName !== 'score-partwise') throw new Error(`Not a MusicXML score (root <${root.nodeName}>)`);
  const warnings: string[] = [];

  const work = kid(root, 'work');
  const title = txt(work && kid(work, 'work-title')) || txt(kid(root, 'movement-title')) || 'Untitled';
  const ident = kid(root, 'identification');
  const composer = ident ? txt(kids(ident, 'creator').find((c) => c.getAttribute('type') === 'composer')) : '';

  const partList = kid(root, 'part-list');
  const partNames = new Map<string, string>();
  if (partList) for (const sp of kids(partList, 'score-part')) partNames.set(sp.getAttribute('id') ?? '', txt(kid(sp, 'part-name')) || txt(kid(sp, 'part-abbreviation')));

  const partEls = kids(root, 'part');
  if (!partEls.length) throw new Error('Score has no parts');
  const nMeasures = Math.max(...partEls.map((p) => kids(p, 'measure').length));

  // ---- pass 1: per part, per measure raw events ----
  const measures: RawMeasure[] = [];
  const partRaw: RawEvent[][][] = []; // part → measure → events
  partEls.forEach((pe, pi) => {
    let divisions = 1;
    let transpose = 0;
    let timeSig: [number, number] = [4, 4];
    let openEnding: number[] | null = null;
    const perMeasure: RawEvent[][] = [];
    kids(pe, 'measure').forEach((me, mi) => {
      const m: RawMeasure = (measures[mi] ??= {
        number: me.getAttribute('number') ?? String(mi + 1), lenQ: 0, timeSig, repeatForward: false,
        repeatBackward: 0, endings: [], tempos: [], implicit: me.getAttribute('implicit') === 'yes',
      });
      if (pi === 0 && openEnding) m.endings = openEnding;
      let closeEnding = false;
      const evs: RawEvent[] = [];
      let cur = 0;
      let maxPos = 0;
      let lastStart = 0;
      for (const el of kids(me)) {
        switch (el.nodeName) {
          case 'attributes': {
            const d = kid(el, 'divisions');
            if (d) divisions = num(d, 1) || 1;
            const t = kid(el, 'time');
            if (t && kid(t, 'beats')) {
              timeSig = [parseInt(txt(kid(t, 'beats'))) || 4, parseInt(txt(kid(t, 'beat-type'))) || 4];
              m.timeSig = timeSig;
            }
            const tr = kid(el, 'transpose');
            if (tr) transpose = num(kid(tr, 'chromatic')) + 12 * num(kid(tr, 'octave-change'));
            break;
          }
          case 'backup':
            cur -= num(kid(el, 'duration')) / divisions;
            if (cur < 0) cur = 0;
            break;
          case 'forward':
            cur += num(kid(el, 'duration')) / divisions;
            maxPos = Math.max(maxPos, cur);
            break;
          case 'direction':
          case 'sound': {
            const snd = el.nodeName === 'sound' ? el : kid(el, 'sound');
            const offQ = cur + (el.nodeName === 'direction' ? num(kid(el, 'offset')) / divisions : 0);
            let qpm = snd?.getAttribute('tempo') ? parseFloat(snd.getAttribute('tempo')!) : NaN;
            let text: string | undefined;
            if (el.nodeName === 'direction') {
              for (const dt of kids(el, 'direction-type')) {
                const met = kid(dt, 'metronome');
                if (met && !Number.isFinite(qpm)) {
                  const unit = txt(kid(met, 'beat-unit'));
                  const dots = kids(met, 'beat-unit-dot').length;
                  const per = num(kid(met, 'per-minute'));
                  const q = ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 } as Record<string, number>)[unit] ?? 1;
                  if (per > 0) qpm = per * q * (dots ? 1.5 : 1);
                }
                const w = kid(dt, 'words');
                if (w && txt(w)) text = txt(w);
              }
            }
            if (Number.isFinite(qpm) && qpm > 0 && pi === 0) m.tempos.push({ offQ, qpm, text });
            break;
          }
          case 'barline': {
            if (pi !== 0) break;
            const rep = kid(el, 'repeat');
            if (rep?.getAttribute('direction') === 'forward') m.repeatForward = true;
            if (rep?.getAttribute('direction') === 'backward') m.repeatBackward = parseInt(rep.getAttribute('times') ?? '2') || 2;
            const end = kid(el, 'ending');
            if (end && end.getAttribute('type') === 'start') {
              openEnding = (end.getAttribute('number') ?? '1').split(/[ ,]+/).map((x) => parseInt(x)).filter((x) => x > 0);
              m.endings = openEnding;
            } else if (end && (end.getAttribute('type') === 'stop' || end.getAttribute('type') === 'discontinue')) {
              closeEnding = true;
            }
            break;
          }
          case 'note': {
            const isChord = !!kid(el, 'chord');
            const grace = !!kid(el, 'grace');
            const cue = !!kid(el, 'cue');
            const durQ = grace ? 0 : num(kid(el, 'duration')) / divisions;
            const start = isChord ? lastStart : cur;
            const pitchEl = kid(el, 'pitch');
            const unp = kid(el, 'unpitched');
            const rest = !!kid(el, 'rest');
            let midi: number | null = null;
            if (pitchEl) {
              midi = (num(kid(pitchEl, 'octave')) + 1) * 12 + STEP[txt(kid(pitchEl, 'step'))] + Math.round(num(kid(pitchEl, 'alter'))) + transpose;
            } else if (unp) midi = null;
            const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
            const nots = kid(el, 'notations');
            if (nots) for (const t of kids(nots, 'tied')) ties.push(t.getAttribute('type'));
            const fermata = !!nots && kids(nots, 'fermata').length > 0;
            const lyrics = cue ? [] : parseLyrics(el);
            const voice = txt(kid(el, 'voice')) || '1';
            const staff = parseInt(txt(kid(el, 'staff'))) || 1;
            if (!cue) {
              if (isChord && evs.length && midi !== null) {
                // add to previous event of same voice at same start
                const prev = [...evs].reverse().find((e) => e.offQ === start && e.voice === voice && !e.grace);
                if (prev) {
                  prev.pitches.push(midi);
                  if (!prev.lyrics.length && lyrics.length) prev.lyrics = lyrics;
                  prev.tieStart ||= ties.includes('start');
                  prev.tieStop ||= ties.includes('stop');
                } else evs.push(mk());
              } else evs.push(mk());
            }
            function mk(): RawEvent {
              return { offQ: start, durQ, pitches: midi !== null && !rest ? [midi] : [], voice, staff, tieStart: ties.includes('start'), tieStop: ties.includes('stop'), lyrics, fermata, grace, rest: rest || midi === null };
            }
            if (!isChord) {
              lastStart = cur;
              cur += durQ;
            }
            maxPos = Math.max(maxPos, cur);
            break;
          }
        }
      }
      if (pi === 0 && closeEnding) openEnding = null;
      m.lenQ = Math.max(m.lenQ, maxPos);
      perMeasure.push(evs);
    });
    partRaw.push(perMeasure);
  });
  measures.forEach((m) => {
    if (m.lenQ <= 0) m.lenQ = (m.timeSig[0] * 4) / m.timeSig[1];
  });

  // ---- pass 2: playback order (repeat expansion) ----
  const order = expandRepeats(measures, warnings);

  // ---- pass 3: unroll into absolute time ----
  const outMeasures: MeasureInfo[] = [];
  const tempos: TempoMark[] = [];
  let q = 0;
  for (const [k, { mi, pass }] of order.entries()) {
    const m = measures[mi];
    outMeasures.push({ index: k + 1, number: m.number, startQ: q, durQ: m.lenQ, timeSig: m.timeSig, srcIndex: mi });
    for (const t of m.tempos) tempos.push({ startQ: q + t.offQ, qpm: t.qpm, text: t.text });
    void pass;
    q += m.lenQ;
  }
  const totalQ = q;
  const dedupTempos = tempos.filter((t, i) => i === 0 || t.startQ !== tempos[i - 1].startQ || t.qpm !== tempos[i - 1].qpm);

  const parts: Part[] = partEls.map((pe, pi) => {
    const id = pe.getAttribute('id') ?? `P${pi + 1}`;
    const name = partNames.get(id) || id;
    const lines = new Map<string, VoiceLine>();
    order.forEach(({ mi, pass }, k) => {
      const mStart = outMeasures[k].startQ;
      for (const e of partRaw[pi][mi] ?? []) {
        const key = `${id}/s${e.staff}/v${e.voice}`;
        let line = lines.get(key);
        if (!line) lines.set(key, (line = { id: key, partId: id, partName: name, staff: e.staff, voice: e.voice, events: [] }));
        // pick the lyric for this pass: verse == pass if present
        const verses = [...new Set(e.lyrics.map((l) => l.verse))];
        let lyrics = e.lyrics;
        if (pass > 1 && verses.includes(pass)) lyrics = e.lyrics.filter((l) => l.verse === pass).map((l) => ({ ...l, verse: 1 }));
        else if (pass > 1 && verses.length > 1) lyrics = e.lyrics.filter((l) => l.verse === Math.min(...verses));
        line.events.push({
          startQ: mStart + e.offQ, durQ: e.durQ, pitches: e.pitches, tieStart: e.tieStart, tieStop: e.tieStop,
          lyrics, measureIndex: k + 1, measureNumber: outMeasures[k].number, fermata: e.fermata, grace: e.grace,
        });
      }
    });
    const voices = [...lines.values()].map((l) => ({ ...l, events: l.events.sort((a, b) => a.startQ - b.startQ) }));
    voices.sort((a, b) => a.staff - b.staff || a.voice.localeCompare(b.voice, undefined, { numeric: true }));
    return { id, name, index: pi, voices };
  });

  return { title, composer, parts, measures: outMeasures, tempos: dedupTempos, totalQ, warnings };
}

function parseLyrics(note: El): Lyric[] {
  const out: Lyric[] = [];
  const all = kids(note, 'lyric');
  all.forEach((ly, i) => {
    const nAttr = ly.getAttribute('number');
    const verse = nAttr && /^\d+$/.test(nAttr) ? parseInt(nAttr) : i + 1;
    // A lyric may hold several syllabic/text pairs joined by <elision>
    const texts: string[] = [];
    const syls: Syllabic[] = [];
    let sep = '';
    for (const c of kids(ly)) {
      if (c.nodeName === 'syllabic') syls.push(txt(c) as Syllabic);
      else if (c.nodeName === 'text') {
        texts.push(sep + (c.textContent ?? ''));
        sep = '';
      } else if (c.nodeName === 'elision') sep = '_';
    }
    const text = texts.join('').trim();
    if (!text && !kid(ly, 'extend')) return;
    if (!text) return; // a bare extender line continues the previous syllable
    const first = syls[0] ?? 'single';
    const last = syls[syls.length - 1] ?? first;
    const newWord = first === 'single' || first === 'begin';
    const hyphenAfter = last === 'begin' || last === 'middle';
    const syllabic: Syllabic = newWord ? (hyphenAfter ? 'begin' : 'single') : hyphenAfter ? 'middle' : 'end';
    out.push({ text, syllabic, extend: !!kid(ly, 'extend'), verse });
  });
  return out;
}

function expandRepeats(ms: RawMeasure[], warnings: string[]): { mi: number; pass: number }[] {
  const hasRepeats = ms.some((m) => m.repeatBackward || m.endings.length);
  if (!hasRepeats) return ms.map((_, mi) => ({ mi, pass: 1 }));
  const out: { mi: number; pass: number }[] = [];
  let start = 0;
  let pass = 1;
  let mi = 0;
  const done = new Set<number>(); // backward repeats already fully taken
  let prevEnding = false;
  while (mi < ms.length) {
    if (out.length > 20 * ms.length) {
      warnings.push('Repeat structure could not be expanded; playing measures in written order');
      return ms.map((_, i) => ({ mi: i, pass: 1 }));
    }
    const m = ms[mi];
    // leaving the last volta: the repeated section is over
    if (!m.endings.length && prevEnding) { pass = 1; start = mi; }
    prevEnding = m.endings.length > 0;
    if (m.repeatForward && pass === 1) start = mi;
    if (m.endings.length && !m.endings.includes(pass)) { mi++; continue; } // volta for another pass
    out.push({ mi, pass });
    if (m.repeatBackward && !done.has(mi)) {
      if (pass < m.repeatBackward) { pass++; mi = start; prevEnding = false; continue; }
      done.add(mi);
      pass = 1;
      start = mi + 1;
    }
    mi++;
  }
  return out;
}
