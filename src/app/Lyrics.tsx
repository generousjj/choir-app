// Lyrics in sync with the audio: the current phrase large with the sounding
// syllable highlighted, the next phrase below, and the whole text as a list
// you can tap to jump to.
import { memo, useEffect, useRef } from 'react';
import type { Phrase } from './phrases';

function PhraseText({ p, cur, big }: { p: Phrase; cur: number; big?: boolean }) {
  const parts: JSX.Element[] = [];
  p.syls.forEach((s, k) => {
    const next = p.syls[k + 1];
    const state = s.index === cur ? 'is-now' : s.index < cur ? 'is-past' : 'is-future';
    const hyphen = next && next.wordIndex === s.wordIndex;
    const melisma = s.notes.length > 1;
    parts.push(
      <span key={s.index} className={`syl ${state}${melisma ? ' melisma' : ''}`} data-i={s.index}>
        {s.text.replace(/[‿_]/g, ' ') || 'ah'}
      </span>,
    );
    parts.push(<span key={`${s.index}s`} className="sep">{hyphen ? '-' : ' '}</span>);
  });
  return <p className={big ? 'phrase big' : 'phrase'}>{parts}</p>;
}

export const Stage = memo(function Stage({ phrases, pi, cur }: { phrases: Phrase[]; pi: number; cur: number }) {
  const p = phrases[pi];
  const n = phrases[pi + 1];
  if (!p) return <div className="stage"><p className="phrase big muted">No lyrics in this part</p></div>;
  return (
    <div className="stage" aria-live="off">
      <PhraseText p={p} cur={cur} big />
      {n ? <PhraseText p={n} cur={cur} /> : <p className="phrase muted">End</p>}
    </div>
  );
});

export const LyricList = memo(function LyricList({ phrases, pi, cur, onPick, onLoop }: {
  phrases: Phrase[]; pi: number; cur: number; onPick: (p: Phrase) => void; onLoop: (p: Phrase) => void;
}) {
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-p="${pi}"]`);
    const sc = box.current;
    if (el && sc) sc.scrollTo({ top: el.offsetTop - sc.offsetTop - 40, behavior: 'smooth' });
  }, [pi]);
  return (
    <ol className="lyric-list" ref={box}>
      {phrases.map((p) => (
        <li key={p.index} data-p={p.index} className={p.index === pi ? 'on' : ''}>
          <button className="lyric-jump" onClick={() => onPick(p)} aria-label={`Play from measure ${p.m0}`}>
            <span className="mnum">m.{p.m0}</span>
            <PhraseText p={p} cur={p.index === pi ? cur : -1} />
          </button>
          <button className="mini" onClick={() => onLoop(p)} aria-label={`Loop measures ${p.m0} to ${p.m1}`}>loop</button>
        </li>
      ))}
    </ol>
  );
});
