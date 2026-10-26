/** Encode mono 16-bit PCM as a RIFF/WAVE file. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  new Int16Array(out.buffer, 44, pcm.length).set(pcm);
  return out;
}

/** Float [-1,1] → Int16 with clipping. */
export function floatToPcm16(x: Float32Array): Int16Array {
  const o = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)));
  return o;
}
