import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { practiceTempoMarks, type SongEntry } from '../engine/catalog';
import { buildStems, mixStems, type AccompMode, type MixGains, type Stems } from '../engine/mix';
import { VOICES } from '../engine/mbrola';
import { renderVocal, type VocalRender } from '../engine/render';
import type { Score } from '../engine/types';
import { findRole, roleFromName, singableLines, type ChordPick, type Role } from '../engine/voices';
import { encodeWav } from '../engine/wav';
import { encodeMp3, saveAudio, warmDownloads } from './download';
import { Engine, loadScoreUrl, parseScoreBytes } from './engine';
import { IconDownload, IconLoop, IconPause, IconPlay, IconReplay, IconSliders, IconStop, IconUpload } from './icons';
import { LyricList, Stage } from './Lyrics';
import { buildPhrases, fmtTime, noteName, phraseAt, syllableAt, type Phrase } from './phrases';
import { Player } from './player';
import { Review } from './Review';
import { SheetView } from './SheetView';
import { deleteScore, getCorrections, listScores, loadPref, putCorrections, putScore, savePref, type Corrections } from './storage';

type View = 'words' | 'music' | 'hidden';
type Panel = 'practice' | 'sound' | 'lyrics' | 'review' | 'about';
interface Prefs {
  songId: string;
  /** the part you sing, remembered across songs: exact line label first, then role + divisi side */
  role: Role;
  pick: ChordPick;
  partLabel: string;
  tempoPct: number;
  voice: string;
  vibrato: boolean;
  octave: number;
  accomp: AccompMode;
  gains: MixGains;
  view: View;
}
const DEFAULT_PREFS: Prefs = {
  songId: 'hallelujah', role: 'B', pick: 'top', partLabel: '', tempoPct: 100, voice: 'us3', vibrato: false, octave: 0,
  accomp: 'off', gains: { voice: 1, guide: 0, accomp: 0.5 }, view: 'words',
};

const ROLE_WORDS: Record<string, string> = { S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' };
/** Menu name of a line: its label, prefixed with the voice when the label doesn't say it (imported scores). */
const partName = (l: { label: string; role: Role }) => (roleFromName(l.label) === l.role || !ROLE_WORDS[l.role] ? l.label : `${ROLE_WORDS[l.role]} — ${l.label}`);

interface Loaded { entry: SongEntry; score: Score; xml: string }

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...loadPref('prefs', DEFAULT_PREFS) }));
  const upd = (p: Partial<Prefs>) => setPrefs((o) => ({ ...o, ...p }));
  useEffect(() => savePref('prefs', prefs), [prefs]);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState('Starting…');
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<SongEntry[]>([]);
  const [userSongs, setUserSongs] = useState<SongEntry[]>([]);
  const [song, setSong] = useState<Loaded | null>(null);
  const [render, setRender] = useState<VocalRender | null>(null);
  const [stems, setStems] = useState<(Stems & { src: VocalRender }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [corr, setCorr] = useState<Corrections>({ text: {}, pron: {} });
  const [loop, setLoop] = useState({ on: false, from: '1', to: '1' });
  const [jump, setJump] = useState('');
  const [tempoDraft, setTempoDraft] = useState(prefs.tempoPct);
  const [note, setNote] = useState('');
  const [panel, setPanel] = useState<Panel>('practice');
  const [drawer, setDrawer] = useState(false); // phone: settings sheet open (always shown on wide screens)

  const player = useRef<Player>(null as unknown as Player);
  if (!player.current) {
    player.current = new Player();
    (window as unknown as { __cppPlayer: Player }).__cppPlayer = player.current; // test hook
  }
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const lastQ = useRef(0); // musical position, survives tempo changes
  // the render the currently loaded audio clip was made from: player time is
  // only meaningful through this render's tempo map
  const clipRender = useRef<VocalRender | null>(null);

  // ---------- startup ----------
  useEffect(() => {
    warmDownloads();
    (async () => {
      try {
        const cat = await fetch('songs/catalog.json').then((r) => r.json());
        // Candlelight arrangements (copyrighted): deployed with the site, kept out of the repository
        const priv = await fetch('songs/candlelight/catalog.json').then((r) => (r.ok ? r.json() : { songs: [] })).catch(() => ({ songs: [] }));
        setCatalog([...(priv.songs ?? []), ...cat.songs]);
        const stored = await listScores();
        setUserSongs(stored.map((s) => ({ id: s.id, title: s.title, composer: s.composer, file: '', user: true })));
        const eng = await Engine.load(setStatus, prefs.voice);
        setEngine(eng);
      } catch (e) {
        setError(`The app could not start: ${(e as Error).message}`);
      }
    })();
    const off = player.current.on(() => setPlaying(player.current.playing));
    return () => { off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- load song ----------
  const allSongs = useMemo(() => [...catalog, ...userSongs], [catalog, userSongs]);
  useEffect(() => {
    if (!allSongs.length) return;
    const entry = allSongs.find((s) => s.id === prefs.songId) ?? allSongs[0];
    let cancel = false;
    (async () => {
      try {
        setStatus(`Opening ${entry.title}…`);
        player.current.stop();
        setRender(null); setStems(null);
        let score: Score; let bytes: Uint8Array;
        if (entry.user) {
          const s = (await listScores()).find((x) => x.id === entry.id);
          if (!s) throw new Error('This imported score is no longer stored on this device.');
          bytes = s.bytes; score = parseScoreBytes(bytes);
        } else ({ score, bytes } = await loadScoreUrl(entry.file));
        if (cancel) return;
        const { musicXmlText } = await import('../engine/musicxml');
        setSong({ entry, score, xml: musicXmlText(bytes) });
        lastQ.current = 0;
        const n = score.measures.length;
        setLoop({ on: false, from: score.measures[0]?.number ?? '1', to: score.measures[Math.min(n - 1, 3)]?.number ?? '1' });
      } catch (e) {
        setError(`Could not open “${entry.title}”: ${(e as Error).message}`);
      }
    })();
    return () => { cancel = true; };
  }, [allSongs, prefs.songId]);

  const lines = useMemo(() => (song ? singableLines(song.score) : []), [song]);
  const line = useMemo(() => {
    if (!lines.length) return undefined;
    return lines.find((l) => l.label === prefs.partLabel)
      ?? lines.find((l) => l.role === prefs.role && l.pick === prefs.pick)
      ?? findRole(lines, prefs.role) ?? lines[lines.length - 1];
  }, [lines, prefs.partLabel, prefs.role, prefs.pick]);
  const pickLine = (key: string) => {
    const l = lines.find((x) => x.key === key);
    if (l) upd({ partLabel: l.label, role: l.role, pick: l.pick });
  };
  const corrKey = song && line ? `${song.entry.id}|${line.key}` : '';
  useEffect(() => { if (corrKey) getCorrections(corrKey).then(setCorr); }, [corrKey]);

  // ---------- render (synthesis) ----------
  useEffect(() => {
    if (!engine || !song || !line) return;
    let cancel = false;
    (async () => {
      setBusy(true);
      try {
        await engine.ensureVoice(prefs.voice, setStatus);
        setStatus(`Singing ${line.label}…`);
        await new Promise((r) => setTimeout(r, 30)); // let the status paint
        if (cancel) return;
        const t0 = performance.now();
        engine.phonemizer.setUserLexicon(song.entry.lexicon ?? {});
        const r = renderVocal(song.score, engine.mbrola, engine.phonemizer, {
          lineKey: line.key, verse: 1, tempoFactor: prefs.tempoPct / 100,
          tempoMarks: practiceTempoMarks(song.entry, song.score), defaultQpm: 100, voice: prefs.voice,
          sing: { vibratoCents: prefs.vibrato ? 18 : 0, transpose: 12 * prefs.octave, onsetDelay: engine.onsets[prefs.voice] },
          overrides: corr.pron, textOverrides: corr.text,
        });
        if (cancel) return;
        setRender(r);
        setStatus(`Ready · synthesized ${fmtTime(r.duration)} of singing in ${Math.round(performance.now() - t0)} ms (${engine.engineKind})`);
      } catch (e) {
        setError(`Synthesis failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    })();
    return () => { cancel = true; };
  }, [engine, song, line, prefs.voice, prefs.tempoPct, prefs.vibrato, prefs.octave, corr]);

  useEffect(() => {
    if (!render || !song) return;
    setStems({ ...buildStems(song.score, render, prefs.accomp, 12 * prefs.octave), src: render });
  }, [render, song, prefs.accomp, prefs.octave]);

  // ---------- clip (mix + loop) ----------
  const measureTime = useCallback((num: string, end = false) => {
    if (!render) return 0;
    const i = render.measures.findIndex((m) => m.number === num);
    if (i < 0) return end ? render.duration : 0;
    if (end) return i + 1 < render.measures.length ? render.measures[i + 1].t : (stems ? stems.length / stems.sampleRate : render.duration);
    return render.measures[i].t;
  }, [render, stems]);

  const clipRange = useMemo(() => {
    if (!render || !stems) return null;
    const full = stems.length / stems.sampleRate;
    if (!loop.on) return { a: 0, b: full, loop: false };
    let a = Math.max(0, measureTime(loop.from) - 0.35); // include consonants sung before the first beat
    let b = Math.min(full, measureTime(loop.to, true));
    if (b - a < 0.5) b = Math.min(full, a + 2);
    return { a, b, loop: true };
  }, [render, stems, loop, measureTime]);

  const gains = useDebounced(prefs.gains, 200);
  useEffect(() => {
    if (!stems || !clipRange || !render || stems.src !== render) return;
    const p = player.current;
    const wasPlaying = p.playing;
    const sr = stems.sampleRate;
    const pcm = mixStems(stems, gains, clipRange.a * sr, clipRange.b * sr);
    let t = render.tempo.sec(lastQ.current) + render.leadIn;
    if (t < clipRange.a || t > clipRange.b) t = clipRange.a;
    clipRender.current = null; // until the new clip is loaded
    void p.setClip(pcm, sr, clipRange.a, clipRange.loop, t, wasPlaying)
      .then(() => { clipRender.current = render; })
      .catch(() => setPlaying(false));
  }, [stems, clipRange, gains, render]);

  // ---------- playhead ----------
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50) return;
      last = now;
      const r = clipRender.current;
      if (!r) return; // a new clip is being prepared
      const t = player.current.time;
      setTime(t);
      lastQ.current = Math.max(0, r.tempo.q(t - r.leadIn));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phrases = useMemo(() => (render ? buildPhrases(render.syllables) : []), [render]);
  const cur = render ? syllableAt(render.syllables, time + 0.02) : -1;
  const curSyl = render && cur >= 0 ? render.syllables[cur] : null;
  const sounding = curSyl && time <= curSyl.t1 + 0.05 ? curSyl : null;
  const pi = phraseAt(phrases, time);
  const pos = useMemo(() => {
    if (!render || !song) return null;
    const q = render.tempo.q(time - render.leadIn);
    const ms = song.score.measures;
    let k = 0;
    while (k + 1 < ms.length && ms[k + 1].startQ <= q + 1e-6) k++;
    return { measureIndex: k + 1, offQ: Math.max(0, q - ms[k].startQ), number: ms[k]?.number ?? '' };
  }, [time, render, song]);

  // ---------- actions ----------
  const play = async () => {
    try {
      // keep the screen on while practising (allowed only while visible)
      (navigator as unknown as { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen').catch(() => undefined);
      await player.current.play();
    } catch {
      setNote('Playback was blocked by the browser. Tap Play again.');
    }
  };
  const toggle = () => (player.current.playing ? player.current.pause() : void play());
  const stop = () => { player.current.pause(); seekSong(clipRange?.a ?? 0); };
  const replay = () => { seekSong(clipRange?.a ?? 0); void play(); };
  const seekSong = (t: number) => {
    player.current.seekSong(t);
    setTime(player.current.time);
    if (render) lastQ.current = Math.max(0, render.tempo.q(t - render.leadIn));
  };
  const goMeasure = (num: string) => {
    if (!render) return;
    const m = render.measures.find((x) => x.number === num.trim());
    if (!m) { setNote(`There is no measure ${num} in this piece (1–${render.measures[render.measures.length - 1].number}).`); return; }
    setNote('');
    const t = Math.max(0, m.t - 0.3);
    if (loop.on && clipRange && (t < clipRange.a || t > clipRange.b)) setLoop((l) => ({ ...l, on: false }));
    lastQ.current = Math.max(0, render.tempo.q(t - render.leadIn));
    seekSong(t);
  };
  const pickPhrase = (p: Phrase) => {
    if (loop.on) setLoop((l) => ({ ...l, on: false }));
    const t = Math.max(0, p.t0 - 0.3);
    if (render) lastQ.current = Math.max(0, render.tempo.q(t - render.leadIn));
    seekSong(t);
    void play();
  };
  const loopPhrase = (p: Phrase) => {
    if (render) lastQ.current = Math.max(0, render.tempo.q(p.t0 - 0.3 - render.leadIn));
    setLoop({ on: true, from: p.m0, to: p.m1 });
  };
  const applyTempo = (v: number) => { setTempoDraft(v); upd({ tempoPct: v }); };

  const download = async (fmt: 'wav' | 'mp3') => {
    if (!stems || !clipRange || !song || !line) return;
    setNote('Preparing file…');
    const sr = stems.sampleRate;
    const pcm = mixStems(stems, prefs.gains, clipRange.a * sr, clipRange.b * sr);
    const base = `${song.entry.title} - ${line.label.replace(/ \(.*\)$/, '')} - ${prefs.tempoPct}%${loop.on ? ` - m${loop.from}-${loop.to}` : ''}`.replace(/[\\/:*?"<>|]/g, '');
    const bytes = fmt === 'wav' ? encodeWav(pcm, sr) : encodeMp3(pcm, sr);
    setNote(await saveAudio(`${base}.${fmt}`, bytes));
  };

  const importFile = async (f: File) => {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const score = parseScoreBytes(bytes);
      const sl = singableLines(score);
      if (!sl.length) throw new Error('No part with lyrics was found. Check that the lyrics were exported with the notes.');
      const id = `user-${Date.now()}`;
      await putScore({ id, title: score.title || f.name, composer: score.composer, fileName: f.name, added: Date.now(), bytes });
      setUserSongs((u) => [...u, { id, title: score.title || f.name, composer: score.composer, file: '', user: true }]);
      upd({ songId: id });
      setPanel('review'); setDrawer(true);
      setNote(`Imported “${score.title || f.name}”: ${score.parts.length} parts, ${score.measures.length} measures, ${sl.length} singable lines. Check the part and lyrics below.`);
    } catch (e) {
      setNote(`Could not import ${f.name}: ${(e as Error).message}`);
    }
  };
  const removeSong = async () => {
    if (!song?.entry.user) return;
    await deleteScore(song.entry.id);
    setUserSongs((u) => u.filter((s) => s.id !== song.entry.id));
    upd({ songId: 'hallelujah' });
  };

  const total = stems ? stems.length / stems.sampleRate : render?.duration ?? 0;
  const qpm = render ? Math.round(render.tempo.initialQpm) : 0;
  const lastMeasure = song?.score.measures[song.score.measures.length - 1]?.number ?? '';

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="eyebrow">Candlelight Choir</span>
          <h1>Part Practice</h1>
        </div>
        <div className="pickers">
          <label className="sr" htmlFor="song">Song</label>
          <select id="song" className="song-select" value={song?.entry.id ?? prefs.songId} onChange={(e) => upd({ songId: e.target.value })}>
            {allSongs.map((s, i) => <option key={s.id} value={s.id}>{s.user ? `${s.title} (imported)` : `${i + 1}. ${s.title}`}</option>)}
          </select>
          <label className="sr" htmlFor="line">Your part</label>
          <select id="line" className="part-select" value={line?.key ?? ''} onChange={(e) => pickLine(e.target.value)} disabled={!lines.length}>
            {lines.map((l) => <option key={l.key} value={l.key}>{partName(l)} · {noteName(l.range[0])}–{noteName(l.range[1])}</option>)}
          </select>
        </div>
        {song && <p className="subtitle">{song.entry.subtitle ?? song.score.composer}{song.entry.composer ? ` · ${song.entry.composer}` : ''}</p>}
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="layout">
        <main className="main">
          <section className="now" aria-label="Now singing">
            <div className="readout">
              <span><span className="k">Measure</span> <b className="mono">{pos?.number ?? '–'}</b><span className="muted"> / {lastMeasure}</span></span>
              <span><span className="k">Note</span> <b className="mono">{prefs.view === 'hidden' ? '?' : sounding ? noteName(sounding.notes[Math.max(0, sounding.notes.findIndex((n) => time < n.t1))]?.midi ?? sounding.notes[0].midi) : '–'}</b></span>
              <span className="mono muted">{fmtTime(time)} / {fmtTime(total)}</span>
            </div>
            <div className="seg" role="radiogroup" aria-label="Show">
              {([['words', 'Words'], ['music', 'Music'], ['hidden', 'Test me']] as [View, string][]).map(([v, t]) => (
                <button key={v} role="radio" aria-checked={prefs.view === v} className={prefs.view === v ? 'on' : ''} onClick={() => upd({ view: v })}>{t}</button>
              ))}
            </div>
            {prefs.view === 'words' && <Stage phrases={phrases} pi={pi} cur={sounding ? cur : -1} />}
            {prefs.view === 'music' && song && line && (
              <SheetView xml={song.xml} score={song.score} partIndex={song.score.parts.find((p) => p.id === line.line.partId)?.index ?? 0} pos={pos} />
            )}
            {prefs.view === 'hidden' && (
              <div className="testme">
                <p className="big-m mono">{pos?.number ?? '–'}</p>
                <p className="hint">Words and notes are hidden. Sing your part from memory, then switch back to check.</p>
              </div>
            )}
            <input
              id="scrub" className="scrub" type="range" min={0} max={total || 1} step={0.05} value={Math.min(time, total)}
              aria-label="Position" onChange={(e) => seekSong(+e.target.value)}
              style={{ ['--a' as string]: clipRange && total ? `${(clipRange.a / total) * 100}%` : '0%', ['--b' as string]: clipRange && total ? `${(clipRange.b / total) * 100}%` : '100%' }}
              data-loop={loop.on ? '1' : '0'}
            />
            <p className="status" aria-live="polite">{busy ? <span className="spin" aria-hidden /> : null}{status}</p>
          </section>
          {note && <p className="note" role="status">{note}</p>}
        </main>

        {drawer && <button className="scrim" aria-label="Close settings" onClick={() => setDrawer(false)} />}
        <aside className={`drawer${drawer ? ' open' : ''}`} aria-label="Practice settings">
          <div className="drawer-head">
            <div className="tabs" role="tablist">
              {([['practice', 'Practice'], ['sound', 'Sound'], ['lyrics', 'Lyrics'], ['review', 'Check'], ['about', 'Song info']] as [Panel, string][]).map(([k, t]) => (
                <button key={k} role="tab" aria-selected={panel === k} className={panel === k ? 'on' : ''} onClick={() => setPanel(k)}>{t}</button>
              ))}
            </div>
            <button className="close" aria-label="Close settings" onClick={() => setDrawer(false)}>×</button>
          </div>

          {panel === 'practice' && (
            <div className="pane">
              <div className="field">
                <label htmlFor="tempo">Tempo <span className="mono">{tempoDraft}%</span>{qpm ? <span className="muted"> · ♩ = {Math.round((qpm * tempoDraft) / prefs.tempoPct)}</span> : null}</label>
                <input id="tempo" type="range" min={40} max={125} step={5} value={tempoDraft}
                  onChange={(e) => setTempoDraft(+e.target.value)}
                  onPointerUp={(e) => applyTempo(+(e.target as HTMLInputElement).value)}
                  onKeyUp={(e) => applyTempo(+(e.target as HTMLInputElement).value)}
                  onTouchEnd={(e) => applyTempo(+(e.target as HTMLInputElement).value)} />
                <div className="row">
                  {[50, 75, 90, 100].map((v) => <button key={v} className={`mini${prefs.tempoPct === v ? ' on' : ''}`} onClick={() => applyTempo(v)}>{v}%</button>)}
                </div>
                <p className="hint">Slower tempos are re-sung at that speed, so the pitch never changes.</p>
              </div>
              <div className="field">
                <span className="label">Loop measures</span>
                <div className="row">
                  <input id="loop-from" className="num" inputMode="numeric" aria-label="Loop from measure" value={loop.from} onChange={(e) => setLoop((l) => ({ ...l, from: e.target.value }))} />
                  <span>to</span>
                  <input id="loop-to" className="num" inputMode="numeric" aria-label="Loop to measure" value={loop.to} onChange={(e) => setLoop((l) => ({ ...l, to: e.target.value }))} />
                  <button className={`btn${loop.on ? ' on' : ''}`} onClick={() => setLoop((l) => ({ ...l, on: !l.on }))}>{loop.on ? 'Looping' : 'Loop'}</button>
                  {phrases[pi] && <button className="btn ghost" onClick={() => loopPhrase(phrases[pi])}>This phrase</button>}
                </div>
              </div>
              <form className="field" onSubmit={(e) => { e.preventDefault(); goMeasure(jump); }}>
                <label htmlFor="jump">Go to measure</label>
                <div className="row">
                  <input id="jump" className="num" inputMode="numeric" placeholder={`1–${lastMeasure}`} value={jump} onChange={(e) => setJump(e.target.value)} />
                  <button className="btn" type="submit">Go</button>
                </div>
              </form>
            </div>
          )}

          {panel === 'sound' && (
            <div className="pane">
              <div className="field">
                <label htmlFor="g-voice">Singing voice <span className="mono">{Math.round(prefs.gains.voice * 100)}%</span></label>
                <input id="g-voice" type="range" min={0} max={1.5} step={0.05} value={prefs.gains.voice} onChange={(e) => upd({ gains: { ...prefs.gains, voice: +e.target.value } })} />
              </div>
              <div className="field">
                <label htmlFor="g-guide">Piano playing your notes <span className="mono">{Math.round(prefs.gains.guide * 100)}%</span></label>
                <input id="g-guide" type="range" min={0} max={1} step={0.05} value={prefs.gains.guide} onChange={(e) => upd({ gains: { ...prefs.gains, guide: +e.target.value } })} />
                <div className="row">
                  <button className="mini" onClick={() => upd({ gains: { ...prefs.gains, voice: 0, guide: Math.max(prefs.gains.guide, 0.7) } })}>Piano only</button>
                  <button className="mini" onClick={() => upd({ gains: { ...prefs.gains, voice: 1, guide: 0 } })}>Voice only</button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="accomp">Accompaniment</label>
                <div className="row">
                  <select id="accomp" value={prefs.accomp} onChange={(e) => upd({ accomp: e.target.value as AccompMode })}>
                    <option value="off">Off</option>
                    <option value="choir">Other choir parts (organ)</option>
                    <option value="full">Full score (choir + orchestra)</option>
                  </select>
                </div>
                {prefs.accomp !== 'off' && (
                  <>
                    <label htmlFor="g-acc" className="sub">Accompaniment volume <span className="mono">{Math.round(prefs.gains.accomp * 100)}%</span></label>
                    <input id="g-acc" type="range" min={0} max={1} step={0.05} value={prefs.gains.accomp} onChange={(e) => upd({ gains: { ...prefs.gains, accomp: +e.target.value } })} />
                  </>
                )}
              </div>
              <div className="field">
                <label htmlFor="voice">Synthetic singer</label>
                <select id="voice" value={prefs.voice} onChange={(e) => upd({ voice: e.target.value })}>
                  {Object.entries(VOICES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <div className="row wrap">
                  <label className="check"><input id="vib" type="checkbox" checked={prefs.vibrato} onChange={(e) => upd({ vibrato: e.target.checked })} /> Gentle vibrato</label>
                  <label className="check">Octave
                    <select id="oct" aria-label="Octave shift" value={prefs.octave} onChange={(e) => upd({ octave: +e.target.value })}>
                      <option value={-1}>−1</option><option value={0}>as written</option><option value={1}>+1</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="field">
                <span className="label">Save audio {loop.on ? `(measures ${loop.from}–${loop.to})` : '(whole piece)'}</span>
                <div className="row">
                  <button className="btn" onClick={() => download('mp3')} disabled={!stems}><IconDownload /> MP3</button>
                  <button className="btn ghost" onClick={() => download('wav')} disabled={!stems}><IconDownload /> WAV</button>
                </div>
              </div>
            </div>
          )}

          {panel === 'lyrics' && <LyricList phrases={phrases} pi={pi} cur={sounding ? cur : -1} onPick={pickPhrase} onLoop={loopPhrase} />}
          {panel === 'review' && render && (
            <Review key={corrKey} syllables={render.syllables} warnings={render.warnings} corrections={corr}
              onChange={(c) => { setCorr(c); void putCorrections(corrKey, c); }}
              onJump={(mi) => goMeasure(song!.score.measures[mi - 1].number)} />
          )}
          {panel === 'about' && (
            <div className="pane about">
              {song && (
                <dl>
                  <dt>Title</dt><dd>{song.score.title}</dd>
                  <dt>Parts</dt><dd>{song.score.parts.map((p) => p.name).join(', ')}</dd>
                  <dt>Measures</dt><dd>{song.score.measures.length}</dd>
                  {line && <><dt>Your line</dt><dd>{line.label}: {line.noteCount} notes, {line.lyricCount} lyric syllables, range {noteName(line.range[0])}–{noteName(line.range[1])}</dd></>}
                  {song.entry.source && <><dt>Source</dt><dd>{song.entry.source}</dd></>}
                  {song.entry.license && <><dt>License</dt><dd>{song.entry.license}</dd></>}
                </dl>
              )}
              {song?.entry.user && <button className="btn ghost" onClick={removeSong}>Remove this imported score</button>}
              <h2>Add a score</h2>
              <p>Import a MusicXML file (<code>.musicxml</code>, <code>.xml</code> or <code>.mxl</code>) exported from MuseScore, Finale, Sibelius or Dorico, or produced by a scanning app from a photo or PDF. It stays on this device. Afterwards, check the lyrics and pronunciation in “Check &amp; correct”.</p>
              <label className="btn file">
                <IconUpload /> Choose MusicXML file
                <input id="import" type="file" accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
              </label>
              <p className="foot">Singing is synthesized on this device with MBROLA (diphone synthesis, AGPL-3.0) and the US English diphone voices from Faculté Polytechnique de Mons (free for non-commercial use). Pronunciations come from the CMU Pronouncing Dictionary. Each note is sung at its exact pitch and duration from the score; nothing is AI-generated.</p>
            </div>
          )}
        </aside>
      </div>

      <nav className="transport" aria-label="Playback">
        <button className="tbtn" onClick={replay} aria-label={loop.on ? 'Replay loop from start' : 'Replay from the beginning'} disabled={!stems}><IconReplay /></button>
        <button className="tbtn play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} disabled={!stems}>{playing ? <IconPause /> : <IconPlay />}</button>
        <button className="tbtn" onClick={stop} aria-label="Stop" disabled={!stems}><IconStop /></button>
        <button className={`tbtn${loop.on ? ' on' : ''}`} onClick={() => setLoop((l) => ({ ...l, on: !l.on }))} aria-pressed={loop.on} aria-label="Loop selected measures" disabled={!stems}><IconLoop /></button>
        <button className={`tbtn gear${drawer ? ' on' : ''}`} onClick={() => setDrawer((d) => !d)} aria-expanded={drawer} aria-label="Settings"><IconSliders /></button>
      </nav>
    </div>
  );
}
