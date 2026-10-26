// Determinism check: the same .pho rendered repeatedly by one engine
// instance (as the app does on every tempo change) must give identical audio.
import { readFileSync } from 'node:fs';
import { createNodeMbrola } from '../src/engine/mbrola-node';
const mb = await createNodeMbrola(['us3']);
const pho = readFileSync(process.argv[2] ?? '/tmp/claude-0/m1-us3/omnipotent.pho', 'utf8');
const other = readFileSync('/tmp/claude-0/m1-us3/kingofkings.pho', 'utf8');
const a = mb.synth(pho, 'us3').pcm;
mb.synth(other, 'us3');
const b = mb.synth(pho, 'us3').pcm;
const same = a.length === b.length && a.every((x, i) => x === b[i]);
console.log(same ? 'DETERMINISTIC: repeated renders are bit-identical' : `NOT deterministic: ${a.filter((x, i) => x !== b[i]).length} samples differ`);
process.exit(same ? 0 : 1);
