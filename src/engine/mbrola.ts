// MBROLA (compiled to WebAssembly, see wasm/build.sh) behind a small API.
// The same wasm binary is used in the browser and in Node tests, so what we
// verify offline is bit-for-bit what the phone plays.

export interface SynthResult {
  pcm: Int16Array;
  sampleRate: number;
  /** MBROLA diagnostics, e.g. "O-O unknown, replaced with _-_" (= audible gap). */
  warnings: string[];
}

// Minimal view of the emscripten module we use.
export interface MbrolaModule {
  FS: {
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string): Uint8Array;
    analyzePath(path: string): { exists: boolean };
    unlink(path: string): void;
  };
  ccall(name: string, ret: 'number', types: string[], args: unknown[]): number;
}

export type MbrolaFactory = (opts: Record<string, unknown>) => Promise<MbrolaModule>;

/** Voices: name → sample rate of the diphone database. */
export const VOICES: Record<string, { rate: number; label: string }> = {
  us3: { rate: 16000, label: 'US male 3 (deeper)' },
  us2: { rate: 16000, label: 'US male 2' },
  us1: { rate: 16000, label: 'US female' },
};

export class Mbrola {
  private log: string[] = [];
  private loaded = new Set<string>();
  private constructor(private M: MbrolaModule) {}

  static async create(factory: MbrolaFactory, extra: Record<string, unknown> = {}): Promise<Mbrola> {
    let self: Mbrola | null = null;
    const sink = (s: string) => self?.log.push(String(s));
    const M = await factory({ ...extra, print: sink, printErr: sink });
    self = new Mbrola(M);
    return self;
  }

  hasVoice(name: string) {
    return this.loaded.has(name);
  }

  addVoice(name: string, data: Uint8Array) {
    this.M.FS.writeFile(`/${name}.db`, data);
    this.loaded.add(name);
  }

  synth(pho: string, voice: string): SynthResult {
    if (!this.loaded.has(voice)) throw new Error(`MBROLA voice ${voice} not loaded`);
    this.log = [];
    this.M.FS.writeFile('/in.pho', pho);
    if (this.M.FS.analyzePath('/out.raw').exists) this.M.FS.unlink('/out.raw');
    let rc: number;
    try {
      rc = this.M.ccall('run_mbrola', 'number', ['string', 'string', 'string'], [`/${voice}.db`, '/in.pho', '/out.raw']);
    } catch (e) {
      throw new Error(`MBROLA failed: ${this.log.join(' ') || String(e)}`);
    }
    if (rc !== 0) throw new Error(`MBROLA exit ${rc}: ${this.log.join(' ')}`);
    const raw = this.M.FS.readFile('/out.raw');
    const pcm = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + (raw.byteLength & ~1)));
    return { pcm, sampleRate: VOICES[voice]?.rate ?? 16000, warnings: this.log.filter((l) => /warning|unknown/i.test(l)) };
  }
}
