// Saving the rendered audio. Inside the claude.ai viewer, pages cannot start
// downloads themselves; the `downloads` capability asks the viewer to save
// the file, and only some extensions are allowed (zip is, wav/mp3 are not),
// so there the audio is wrapped in a .zip. Anywhere else (local server,
// any browser) the file downloads directly.
import { zipSync } from 'fflate';
import { Mp3Encoder } from '@breezystack/lamejs';

interface DownloadsNS {
  save(r: { filename: string; data: Blob | ArrayBuffer | Uint8Array }): Promise<{ status: string }>;
}
type ClaudeWin = { claude?: { use(name: string): Promise<unknown> } };

let downloadsP: Promise<DownloadsNS | null> | null = null;
function viewerDownloads(): Promise<DownloadsNS | null> {
  const c = (window as unknown as ClaudeWin).claude;
  if (!c?.use) return Promise.resolve(null);
  downloadsP ??= c.use('downloads').then((d) => (d as DownloadsNS) ?? null).catch(() => null);
  return downloadsP;
}
/** Resolve early so the first click does not wait. */
export function warmDownloads() {
  void viewerDownloads();
}

export function encodeMp3(pcm: Int16Array, sampleRate: number, kbps = 96): Uint8Array {
  const enc = new Mp3Encoder(1, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152 * 16) {
    const b = enc.encodeBuffer(pcm.subarray(i, i + 1152 * 16));
    if (b.length) chunks.push(new Uint8Array(b));
  }
  const end = enc.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Returns a short status message for the UI. */
export async function saveAudio(fileName: string, bytes: Uint8Array): Promise<string> {
  const d = await viewerDownloads();
  if (d) {
    const zipName = fileName.replace(/\.(wav|mp3)$/i, '') + '.zip';
    const zip = zipSync({ [fileName]: [bytes, { level: 0 }] });
    try {
      await d.save({ filename: zipName, data: new Blob([zip]) });
      return `Saved ${zipName} (contains ${fileName})`;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return 'Save cancelled';
      return `Could not save here (${code ?? 'unavailable'}). Open the app in a regular browser to download.`;
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: fileName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return `Downloaded ${fileName}`;
}
