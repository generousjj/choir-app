// Offline render of one voice of a catalog song (same engine as the app).
//   npx tsx tools/render.ts <songId|file.musicxml> <S|A|T|B> <out.wav> [--tempo 1] [--voice us3] [--from m] [--to m]
// Also writes <out>.json with the per-note truth used by tools/verify_pitch.py
// and the lyric timeline used by tools/check_lyrics.py.
import { readFileSync, writeFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { parseMusicXML, musicXmlText } from '../src/engine/musicxml';
import { parseCmuDict, Phonemizer } from '../src/engine/phonemizer';
import { createNodeMbrola, onsetDelays } from '../src/engine/mbrola-node';
import { renderVocal } from '../src/engine/render';
import { singableLines, findRole, type Role } from '../src/engine/voices';
import { practiceTempoMarks, type SongEntry } from '../src/engine/catalog';
import { encodeWav } from '../src/engine/wav';

const [src, role, out, ...rest] = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const catalog: { songs: SongEntry[] } = JSON.parse(readFileSync('public/songs/catalog.json', 'utf8'));
const song = catalog.songs.find((s) => s.id === src);
const file = song ? `public/${song.file}` : src;
const xml = musicXmlText(readFileSync(file));
const t0 = Date.now();
const score = parseMusicXML(xml, (s) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document);
const lines = singableLines(score);
const line = findRole(lines, role as Role);
if (!line) throw new Error(`no ${role} line; have: ${lines.map((l) => `${l.role}:${l.label}`).join(', ')}`);
const voice = flag('voice', 'us3');
const mb = await createNodeMbrola([voice]);
const ph = new Phonemizer(parseCmuDict(readFileSync('assets/dict/cmudict.dict', 'utf8')), undefined, JSON.parse(flag('lex', '{}')));
const t1 = Date.now();
const r = renderVocal(score, mb, ph, { lineKey: line.key, verse: 1, tempoFactor: +flag('tempo', '1'), tempoMarks: practiceTempoMarks(song, score), voice, sing: { onsetDelay: onsetDelays(voice), ...JSON.parse(flag('sing', '{}')) } });
const t2 = Date.now();
let pcm = r.pcm;
let off = 0;
const from = +flag('from', '0'), to = +flag('to', '0');
let sylls = r.syllables;
if (from || to) {
  const a = r.measures.find((m) => +m.number === (from || 1))!.t - 0.3;
  const bm = r.measures.find((m) => +m.number === to + 1);
  const b = bm ? bm.t : r.duration;
  pcm = pcm.slice(Math.floor(a * r.sampleRate), Math.floor(b * r.sampleRate));
  off = a;
  sylls = sylls.filter((s) => s.notes[0].t0 >= a + 0.25 && s.t1 <= b + 0.05);
}
writeFileSync(out, encodeWav(pcm, r.sampleRate));
writeFileSync(out.replace(/\.wav$/, '') + '.json', JSON.stringify({
  leadIn: 0,
  line: line.label,
  truth: sylls.flatMap((s) => s.notes.map((n) => ({ text: s.text, midi: n.midi, t0: n.t0 - off, t1: n.t1 - off, m: s.measureNumber }))),
  syllables: sylls.map((s) => ({ text: s.text, word: s.word, wi: s.wordIndex, m: s.measureNumber, t0: s.t0 - off, v: s.vowelT0 - off, t1: s.t1 - off, ph: [s.phon.onset, s.phon.nucleus, s.phon.coda].map((x) => x.join(' ')).join(' | '), src: s.phon.source })),
  warnings: r.warnings,
}, null, 1));
console.log(`${line.label}: ${r.syllables.length} syllables, ${r.syllables.reduce((a, s) => a + s.notes.length, 0)} notes, ${r.duration.toFixed(1)} s audio; parse ${t1 - t0} ms, render ${t2 - t1} ms`);
if (r.warnings.length) console.log('warnings:', r.warnings);
