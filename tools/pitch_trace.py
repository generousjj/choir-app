"""Frame-by-frame pitch trace of a render vs the score (incl. transitions).
usage: python tools/pitch_trace.py render.wav t_start t_end out.png
Prints transition statistics for the whole file: for each note, how long after
the note's start the sung pitch first settles within 30 cents (lag), and the
fraction of the note's voiced time spent within ±30 cents (stability)."""
import sys, json
import numpy as np, librosa, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
wav, a, b, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
J = json.load(open(wav[:-4] + '.json'))
y, sr = librosa.load(wav, sr=None)
hop = 80
f0, vo, _ = librosa.pyin(y, fmin=60, fmax=500, sr=sr, frame_length=1024, hop_length=hop)
t = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop)
cent = lambda hz, m: 1200 * np.log2(hz / (440 * 2 ** ((m - 69) / 12)))
lags, stab, worst = [], [], []
for n in J['truth']:
    sel = (t >= n['t0']) & (t < n['t1']) & vo
    if sel.sum() < 3: continue
    c = cent(f0[sel], n['midi'])
    c = np.where(np.abs(c) > 600, c - 1200 * np.round(c / 1200), c)  # fold pYIN octave slips
    ok = np.abs(c) < 30
    stab.append(ok.mean())
    first = np.argmax(ok) if ok.any() else len(ok)
    lags.append(t[sel][min(first, len(ok) - 1)] - n['t0'])
    worst.append((ok.mean(), lags[-1], n))
lags = np.array(lags); stab = np.array(stab)
print(f"notes {len(stab)}: mean time within ±30c {stab.mean():.0%}; notes <70% stable: {(stab < .7).sum()}; "
      f"settle lag median {np.median(lags)*1000:.0f} ms, p90 {np.percentile(lags, 90)*1000:.0f} ms")
for sc, lg, n in sorted(worst, key=lambda w: w[0])[:12]:
    print(f"  {n['t0']:7.2f}s m.{n.get('m','?'):>3} {n['text']:>8} midi {n['midi']}  dur {1000*(n['t1']-n['t0']):4.0f} ms  stable {sc:4.0%}  settle {1000*lg:4.0f} ms")
fig, ax = plt.subplots(figsize=(16, 5))
sel = (t >= a) & (t <= b)
ax.plot(t[sel], librosa.hz_to_midi(np.where(vo, f0, np.nan))[sel], '.', ms=2, label='sung (pYIN)')
for n in J['truth']:
    if n['t1'] < a or n['t0'] > b: continue
    ax.hlines(n['midi'], n['t0'], n['t1'], colors='C1', lw=3, alpha=.6)
for s in J['syllables']:
    if s['t1'] < a or s['t0'] > b: continue
    ax.axvline(s['t0'], color='gray', lw=.5); ax.axvline(s['v'], color='green', lw=.5, ls=':')
    ax.text(s['v'], ax.get_ylim()[0] if False else 0, '', fontsize=7)
lo = min(n['midi'] for n in J['truth'] if a <= n['t0'] <= b) - 3; hi = max(n['midi'] for n in J['truth'] if a <= n['t0'] <= b) + 3
ax.set_ylim(lo, hi)
for s in J['syllables']:
    if a <= s['v'] <= b: ax.text(s['v'], hi - 1, s['text'], fontsize=8)
ax.set_xlabel('s'); ax.set_ylabel('MIDI'); ax.set_title('orange = score, blue = sung, grey = syllable start, green = vowel start'); ax.grid(alpha=.3)
fig.tight_layout(); fig.savefig(out, dpi=80)
