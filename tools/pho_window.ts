// Print the .pho segments of a catalog song's voice between two times (debugging).
//   npx tsx tools/pho_window.ts hallelujah B 44.0 44.8
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { parseMusicXML, musicXmlText } from '../src/engine/musicxml';
import { parseCmuDict, Phonemizer } from '../src/engine/phonemizer';
import { createNodeMbrola } from '../src/engine/mbrola-node';
import { renderVocal } from '../src/engine/render';
import { singableLines, findRole, type Role } from '../src/engine/voices';
import { practiceTempoMarks, type SongEntry } from '../src/engine/catalog';

const [id, role, a, b] = process.argv.slice(2);
const song = ([...JSON.parse(readFileSync('public/songs/catalog.json', 'utf8')).songs, ...(() => { try { return JSON.parse(readFileSync('public/songs/candlelight/catalog.json', 'utf8')).songs; } catch { return []; } })()] as SongEntry[]).find((s) => s.id === id)!;
const score = parseMusicXML(musicXmlText(readFileSync('public/' + song.file)), (s) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document);
const line = findRole(singableLines(score), role as Role)!;
const r = renderVocal(score, await createNodeMbrola(['us3']), new Phonemizer(parseCmuDict(readFileSync('assets/dict/cmudict.dict', 'utf8'))),
  { lineKey: line.key, verse: 1, tempoFactor: 1, tempoMarks: practiceTempoMarks(song, score), voice: 'us3' });
let t = 0;
for (const l of r.pho.split('\n')) {
  const p = l.split(' ');
  if (l.startsWith(';') || p.length < 2) continue;
  const d = +p[1] / 1000;
  if (t + d >= +a && t <= +b) console.log(t.toFixed(3), (t + d).toFixed(3), l.slice(0, 70));
  t += d;
}
