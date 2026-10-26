// Browser side of the engine: loads MBROLA (WebAssembly, or the asm.js build
// when the page's security policy forbids WebAssembly), the pronunciation
// dictionary and voices, all from files published next to the page.
import { gunzipSync } from 'fflate';
import { Mbrola, type MbrolaFactory } from '../engine/mbrola';
import { musicXmlText, parseMusicXML } from '../engine/musicxml';
import { parseCmuDict, Phonemizer } from '../engine/phonemizer';
import type { Score } from '../engine/types';

export type Progress = (msg: string) => void;

/**
 * Some hosts (the claude.ai Artifact viewer) only serve web media types, so
 * the packaged page ships binary data as base64 text: `x.gz` → `x.gz.b64.txt`
 * (see tools/build_artifact.mjs, which sets window.__CPP_ASSETS = 'b64').
 */
const BASE64_ASSETS = (globalThis as { __CPP_ASSETS?: string }).__CPP_ASSETS === 'b64';

async function fetchBytes(url: string, binary = false): Promise<Uint8Array> {
  const u = binary && BASE64_ASSETS ? `${url}.b64.txt` : url;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Could not load ${u} (HTTP ${r.status})`);
  if (u.endsWith('.b64.txt')) {
    const s = atob((await r.text()).replace(/\s+/g, ''));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  return new Uint8Array(await r.arrayBuffer());
}

const gunzipMaybe = (b: Uint8Array) => (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b);

export class Engine {
  engineKind: 'wasm' | 'asm.js' = 'wasm';
  /** Measured voicing delays per voice (tools/measure_onsets.ts). */
  onsets: Record<string, Record<string, number>> = {};
  private constructor(public mbrola: Mbrola, public phonemizer: Phonemizer) {}

  static async load(progress: Progress, voice: string): Promise<Engine> {
    progress('Loading singing synthesizer…');
    let kind: Engine['engineKind'] = 'wasm';
    let mbrola: Mbrola;
    try {
      const [{ default: factory }, wasm] = await Promise.all([
        import('../engine/wasm/mbrola.mjs') as Promise<{ default: MbrolaFactory }>,
        fetchBytes('wasm/mbrola.wasm'),
      ]);
      mbrola = await Mbrola.create(factory, { wasmBinary: wasm });
    } catch (e) {
      console.warn('WebAssembly MBROLA unavailable, using asm.js build', e);
      const { default: factory } = (await import('../engine/wasm/mbrola-asm.mjs')) as { default: MbrolaFactory };
      mbrola = await Mbrola.create(factory);
      kind = 'asm.js';
    }
    progress('Loading English pronunciation dictionary…');
    const dict = parseCmuDict(new TextDecoder().decode(gunzipMaybe(await fetchBytes('dict/cmudict.dict.gz', true))));
    const eng = new Engine(mbrola, new Phonemizer(dict));
    eng.engineKind = kind;
    await eng.ensureVoice(voice, progress);
    return eng;
  }

  async ensureVoice(voice: string, progress: Progress) {
    if (this.mbrola.hasVoice(voice)) return;
    progress(`Loading voice ${voice}…`);
    const [db, on] = await Promise.all([
      fetchBytes(`voices/${voice}.gz`, true),
      fetch(`voices/${voice}.onsets.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    this.mbrola.addVoice(voice, gunzipMaybe(db));
    this.onsets[voice] = on;
  }
}

export function parseScoreBytes(data: Uint8Array): Score {
  const xml = musicXmlText(data);
  return parseMusicXML(xml, (s) => {
    const doc = new DOMParser().parseFromString(s, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('This file is not valid MusicXML: ' + (err.textContent ?? '').slice(0, 200));
    return doc;
  });
}

export async function loadScoreUrl(url: string): Promise<{ score: Score; bytes: Uint8Array }> {
  const bytes = await fetchBytes(url);
  return { score: parseScoreBytes(bytes), bytes };
}
