// Quarter-note positions ↔ seconds, honouring tempo changes in the score
// (or song-level practice overrides) scaled by the user's tempo factor.
import type { TempoMark } from './types';

export class TempoMap {
  private marks: { q: number; qpm: number; s: number }[] = [];

  constructor(marks: TempoMark[], factor = 1, defaultQpm = 100) {
    const sorted = [...marks].sort((a, b) => a.startQ - b.startQ);
    if (!sorted.length || sorted[0].startQ > 0) sorted.unshift({ startQ: 0, qpm: sorted[0]?.qpm ?? defaultQpm });
    let s = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) s += ((sorted[i].startQ - sorted[i - 1].startQ) * 60) / (sorted[i - 1].qpm * factor);
      this.marks.push({ q: sorted[i].startQ, qpm: sorted[i].qpm * factor, s });
    }
  }

  sec(q: number): number {
    let m = this.marks[0];
    for (const x of this.marks) if (x.q <= q) m = x;
    return m.s + ((q - m.q) * 60) / m.qpm;
  }

  q(sec: number): number {
    let m = this.marks[0];
    for (const x of this.marks) if (x.s <= sec) m = x;
    return m.q + ((sec - m.s) * m.qpm) / 60;
  }

  /** Effective quarter-note tempo at the start. */
  get initialQpm() {
    return this.marks[0].qpm;
  }
}
