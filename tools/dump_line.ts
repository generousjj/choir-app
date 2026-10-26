// Dump every note of the S/A/T/B lines as JSON (onset, duration, pitch, lyric).
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { parseMusicXML, musicXmlText } from '../src/engine/musicxml';
import { singableLines, findRole } from '../src/engine/voices';
const score = parseMusicXML(musicXmlText(readFileSync(process.argv[2])), (s) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document);
const out: Record<string, unknown[]> = {};
for (const r of ['S', 'A', 'T', 'B'] as const) {
  const l = findRole(singableLines(score), r);
  if (l) out[r] = l.line.events.filter((e) => e.pitches.length).map((e) => [e.startQ, e.durQ, e.pitches[0], e.lyrics[0]?.text ?? '', e.measureNumber]);
}
console.log(JSON.stringify(out));
