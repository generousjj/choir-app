// Node loader for the wasm MBROLA build (tests, offline tools).
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mbrola, type MbrolaFactory } from './mbrola';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function createNodeMbrola(voices: string[] = ['us3']): Promise<Mbrola> {
  const require = createRequire(import.meta.url);
  const factory = require(join(root, 'wasm/dist/mbrola-node.cjs')) as MbrolaFactory;
  const m = await Mbrola.create(factory, { wasmBinary: readFileSync(join(root, 'wasm/dist/mbrola-node.wasm')) });
  for (const v of voices) m.addVoice(v, readFileSync(voicePath(v)));
  return m;
}

/** Measured voicing delays for the singer (see tools/measure_onsets.ts). */
export function onsetDelays(v: string): Record<string, number> {
  const f = join(root, 'public/voices', `${v}.onsets.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}

export function voicePath(v: string): string {
  const local = join(root, 'public/voices', v);
  return existsSync(local) ? local : `/usr/share/mbrola/${v}/${v}`;
}
