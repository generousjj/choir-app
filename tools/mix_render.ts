// Offline reproduction of the app's mix (voice + piano guide), for comparing with audio captured from the browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { parseMusicXML, musicXmlText } from '../src/engine/musicxml';
import { parseCmuDict, Phonemizer } from '../src/engine/phonemizer';
import { createNodeMbrola, onsetDelays } from '../src/engine/mbrola-node';
import { renderVocal } from '../src/engine/render';
import { singableLines, findRole } from '../src/engine/voices';
import { practiceTempoMarks } from '../src/engine/catalog';
import { buildStems, mixStems } from '../src/engine/mix';
import { encodeWav } from '../src/engine/wav';
const R = '';
const song = JSON.parse(readFileSync(R + 'public/songs/catalog.json', 'utf8')).songs[0];
const score = parseMusicXML(musicXmlText(readFileSync(R + 'public/' + song.file)), (s) => new DOMParser().parseFromString(s, 'text/xml') as any);
const line = findRole(singableLines(score), 'B')!;
const r = renderVocal(score, await createNodeMbrola(['us3']), new Phonemizer(parseCmuDict(readFileSync(R + 'assets/dict/cmudict.dict', 'utf8'))),
  { lineKey: line.key, verse: 1, tempoFactor: 1, tempoMarks: practiceTempoMarks(song, score), defaultQpm: 100, voice: 'us3', sing: { vibratoCents: 0, transpose: 0, onsetDelay: onsetDelays('us3') } });
const st = buildStems(score, r, 'off', 0);
for (const [name, g] of [['node-mix', { voice: 1, guide: 0.3, accomp: 0.5 }], ['node-voice', { voice: 1, guide: 0, accomp: 0 }]] as const)
  writeFileSync(`/tmp/claude-0/e2e/${name}.wav`, encodeWav(mixStems(st, g), r.sampleRate));
