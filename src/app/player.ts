// Playback through an <audio> element fed with a WAV blob.
//
// Why not Web Audio? On iPhone, Web Audio output is silenced by the ringer
// switch and must be unlocked inside a tap; a media element plays through
// the silent switch, keeps playing with the screen locked, shows lock-screen
// controls, and seeks precisely in uncompressed WAV.
//
// A loop is played as its own looping clip (audio.loop) so it repeats
// seamlessly even when the page is in the background; `offset` maps the
// clip's currentTime back onto the song's timeline.
import { encodeWav } from '../engine/wav';

export class Player {
  readonly audio: HTMLAudioElement;
  private url: string | null = null;
  /** Song time (s) at the start of the current clip. */
  offset = 0;
  clipDuration = 0;
  private listeners = new Set<() => void>();

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    for (const ev of ['play', 'pause', 'ended', 'seeked', 'loadedmetadata']) this.audio.addEventListener(ev, () => this.emit());
  }

  on(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  /** Current position on the song timeline (seconds). */
  get time() {
    return this.offset + (this.audio.currentTime || 0);
  }

  /**
   * Replace the audio. `songTime` is where playback should continue (on the
   * song timeline); `resume` restarts playback if it was playing.
   */
  async setClip(pcm: Int16Array, sampleRate: number, offset: number, loop: boolean, songTime: number, resume: boolean) {
    const blob = new Blob([encodeWav(pcm, sampleRate)], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = this.audio;
    a.pause();
    a.loop = loop;
    a.src = url;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = url;
    this.offset = offset;
    this.clipDuration = pcm.length / sampleRate;
    a.load();
    await new Promise<void>((res) => {
      if (a.readyState >= 1) return res();
      a.addEventListener('loadedmetadata', () => res(), { once: true });
      a.addEventListener('error', () => res(), { once: true });
    });
    this.seekSong(songTime);
    if (resume) await this.play();
    this.emit();
  }

  seekSong(t: number) {
    const local = Math.max(0, Math.min(this.clipDuration - 0.01, t - this.offset));
    try {
      this.audio.currentTime = Number.isFinite(local) ? local : 0;
    } catch {
      /* not seekable yet */
    }
    this.emit();
  }

  async play() {
    if (this.audio.ended) this.audio.currentTime = 0;
    try {
      await this.audio.play();
    } catch (e) {
      console.warn('play() refused', e);
      throw e;
    }
  }

  pause() {
    this.audio.pause();
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.emit();
  }

  /** The playing clip as a WAV blob (for download). */
  async currentBlob(): Promise<Blob | null> {
    if (!this.url) return null;
    return (await fetch(this.url)).blob();
  }
}
