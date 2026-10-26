// Review & correct what the singer will sing: every syllable with its notes,
// lyric text and pronunciation. Words not found in the dictionary (spelled
// by rule) and notes without lyrics are flagged first. Corrections are saved
// per song and part on this device and applied on the next render.
import { useMemo, useState } from 'react';
import type { TimedSyl } from '../engine/render';
import { noteName } from './phrases';
import type { Corrections } from './storage';

interface Props {
  syllables: TimedSyl[];
  warnings: string[];
  corrections: Corrections;
  onChange: (c: Corrections) => void;
  onJump: (measureIndex: number) => void;
}

const SRC_LABEL: Record<string, string> = {
  dict: 'dictionary', diction: 'choral diction', morph: 'derived', rule: 'guessed from spelling', override: 'your correction',
};

export function Review({ syllables, warnings, corrections, onChange, onJump }: Props) {
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [draft, setDraft] = useState<Corrections>(corrections);
  const flagged = (s: TimedSyl) => s.phon.source === 'rule' || !s.text.trim();
  const rows = useMemo(() => syllables.filter((s) => !onlyFlagged || flagged(s) || draft.text[s.index] !== undefined || draft.pron[s.index] !== undefined), [syllables, onlyFlagged, draft]);
  const nFlagged = syllables.filter(flagged).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(corrections);

  const setText = (i: number, v: string) => setDraft((d) => ({ ...d, text: { ...d.text, [i]: v } }));
  const setPron = (i: number, v: string) => setDraft((d) => {
    const pron = { ...d.pron };
    if (v.trim()) pron[i] = v.toUpperCase(); else delete pron[i];
    return { ...d, pron };
  });

  return (
    <div className="review">
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      <div className="row wrap">
        <label className="check">
          <input id="rv-flag" type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          Only show syllables to check ({nFlagged})
        </label>
        <button className="btn" disabled={!dirty} onClick={() => onChange(draft)}>Apply corrections</button>
        <button className="btn ghost" disabled={!dirty} onClick={() => setDraft(corrections)}>Discard</button>
      </div>
      <p className="hint">Pronunciation uses ARPAbet, e.g. <code>HH AA L EH L UW Y AA</code> for “Hallelujah”. It applies to the whole word.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>m.</th><th>Notes</th><th>Lyric</th><th>Pronunciation</th><th>Source</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Nothing needs checking. Untick the box to see every syllable.</td></tr>}
            {rows.slice(0, 400).map((s) => (
              <tr key={s.index} className={flagged(s) ? 'flag' : ''}>
                <td><button className="link" onClick={() => onJump(s.measureIndex)}>{s.measureNumber}</button></td>
                <td className="mono">{s.notes.map((n) => noteName(n.midi)).join(' ')}</td>
                <td>
                  <input id={`rv-t-${s.index}`} aria-label={`Lyric for syllable ${s.index + 1}`} value={draft.text[s.index] ?? s.text} onChange={(e) => setText(s.index, e.target.value)} />
                </td>
                <td>
                  {s.sylInWord === 0 ? (
                    <input id={`rv-p-${s.index}`} className="mono" aria-label={`Pronunciation of ${s.word}`} placeholder={s.phon.arpabet} value={draft.pron[s.index] ?? ''} onChange={(e) => setPron(s.index, e.target.value)} />
                  ) : <span className="muted">↑ {s.word}</span>}
                </td>
                <td><span className={`badge ${s.phon.source}`}>{SRC_LABEL[s.phon.source] ?? s.phon.source}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 400 && <p className="muted">Showing the first 400 of {rows.length}.</p>}
      </div>
    </div>
  );
}
