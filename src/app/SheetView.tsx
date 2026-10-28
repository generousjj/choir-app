// Sheet music for the selected part (OpenSheetMusicDisplay), with a cursor
// that follows playback. Other parts are hidden so it stays legible on a phone.
import { useEffect, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { Score } from '../engine/types';

interface Props {
  xml: string;
  score: Score;
  partIndex: number;
  /** current position: unrolled measure index (1-based) and quarter offset in it */
  pos: { measureIndex: number; offQ: number } | null;
  /** a note or lyric was tapped: unrolled measure index (1-based) and quarter offset in it */
  onSeek?: (measureIndex: number, offQ: number) => void;
}

interface Step { mi: number; off: number }

export function SheetView({ xml, score, partIndex, pos, onSeek }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const steps = useRef<Step[]>([]);
  const cur = useRef(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState('');
  const lib = useRef<typeof import('opensheetmusicdisplay') | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        lib.current = await import('opensheetmusicdisplay');
        const { OpenSheetMusicDisplay } = lib.current;
        if (cancelled || !host.current) return;
        host.current.innerHTML = '';
        const osmd = new OpenSheetMusicDisplay(host.current, {
          autoResize: true, backend: 'svg', drawTitle: false, drawSubtitle: false, drawComposer: false,
          drawLyricist: false, drawPartNames: false, drawCredits: false, drawingParameters: 'compacttight',
          followCursor: false, cursorsOptions: [{ type: 0, color: '#d08a1e', alpha: 0.45, follow: false }],
        });
        await osmd.load(xml);
        osmd.Sheet.Instruments.forEach((ins, i) => (ins.Visible = i === partIndex));
        osmd.Zoom = (host.current.clientWidth || 360) < 520 ? 0.62 : 0.85;
        osmd.render();
        osmd.cursor.show();
        // record every cursor position as (written measure, offset in quarters)
        const it = osmd.cursor.iterator;
        const list: Step[] = [];
        osmd.cursor.reset();
        let guard = 0;
        while (!osmd.cursor.iterator.EndReached && guard++ < 20000) {
          const mi = osmd.cursor.iterator.CurrentMeasureIndex;
          const sm = osmd.Sheet.SourceMeasures[mi];
          const off = (osmd.cursor.iterator.currentTimeStamp.RealValue - sm.AbsoluteTimestamp.RealValue) * 4;
          list.push({ mi, off });
          osmd.cursor.iterator.moveToNext();
        }
        void it;
        osmd.cursor.reset();
        steps.current = list;
        cur.current = 0;
        osmdRef.current = osmd;
        if (!cancelled) setState('ready');
      } catch (e) {
        console.error(e);
        if (!cancelled) { setErr(String((e as Error).message ?? e)); setState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [xml, partIndex]);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (state !== 'ready' || !osmd || !pos) return;
    const m = score.measures[pos.measureIndex - 1];
    if (!m) return;
    const list = steps.current;
    let target = -1;
    for (let k = 0; k < list.length; k++) {
      if (list[k].mi === m.srcIndex) {
        if (list[k].off <= pos.offQ + 1e-6 || target < 0) target = k;
        else break;
      } else if (target >= 0) break;
    }
    if (target < 0 || target === cur.current) return;
    if (target < cur.current) { osmd.cursor.reset(); cur.current = 0; }
    while (cur.current < target) { osmd.cursor.iterator.moveToNext(); cur.current++; }
    osmd.cursor.update();
    const el = osmd.cursor.cursorElement as HTMLElement | undefined;
    const sc = scroller.current;
    if (el && sc) {
      const top = el.offsetTop - sc.clientHeight / 3;
      if (Math.abs(sc.scrollTop - top) > sc.clientHeight / 4) sc.scrollTo({ top, behavior: 'smooth' });
    }
  }, [pos?.measureIndex, pos?.offQ, state, score]);

  // tap a note or lyric: find the nearest note of the drawn part, then the performance
  // occurrence of that written measure closest to where you are now (repeats repeat it)
  const onClick = (e: React.MouseEvent) => {
    const osmd = osmdRef.current;
    const svg = host.current?.querySelector('svg');
    if (state !== 'ready' || !osmd || !svg || !lib.current || !onSeek) return;
    const r = svg.getBoundingClientRect();
    const unit = 10 * osmd.Zoom;
    const se = osmd.GraphicSheet.GetNearestStaffEntry(new lib.current.PointF2D((e.clientX - r.left) / unit, (e.clientY - r.top) / unit));
    if (!se) return;
    const src = se.parentMeasure.parentSourceMeasure.measureListIndex;
    const off = se.sourceStaffEntry.Timestamp.RealValue * 4;
    const here = pos?.measureIndex ?? 1;
    let best = -1;
    score.measures.forEach((m, i) => {
      if (m.srcIndex === src && (best < 0 || Math.abs(i + 1 - here) < Math.abs(best + 1 - here))) best = i;
    });
    if (best >= 0) onSeek(best + 1, off);
  };

  return (
    <div className="sheet" ref={scroller} onClick={onClick} title="Tap a note to play from there">
      {state === 'loading' && <p className="muted">Engraving your part…</p>}
      {state === 'error' && <p className="error">Sheet music could not be drawn: {err}</p>}
      <div ref={host} className="sheet-host" />
    </div>
  );
}
