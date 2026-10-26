"""Measure the sung pitch of every note and compare with the score.

usage: python tools/verify_pitch.py render.wav truth.json [--tol 25]
truth.json: {"leadIn": s, "truth": [{"text","midi","t0","t1"}, ...]}
Uses pYIN (probabilistic YIN) on the middle 60% of each note so that consonants
and legato glides are excluded. Prints a per-note table and a summary; exits 1
if any note's median pitch is off by more than --tol cents.
"""
import json, sys, argparse
import numpy as np, librosa

NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
def name(m): return f"{NAMES[m % 12]}{m // 12 - 1}"

ap = argparse.ArgumentParser()
ap.add_argument('wav'); ap.add_argument('truth'); ap.add_argument('--tol', type=float, default=25)
ap.add_argument('--quiet', action='store_true')
a = ap.parse_args()
y, sr = librosa.load(a.wav, sr=None)
T = json.load(open(a.truth))
lead = T.get('leadIn', 0)
hop = 160
f0, voiced, _ = librosa.pyin(y, fmin=50, fmax=700, sr=sr, frame_length=1024, hop_length=hop)
times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop)
def refine(y, sr, a, b, coarse):
    """Average f0 over [a,b]: autocorrelation peak near the pYIN estimate,
    with parabolic interpolation (sub-sample period accuracy)."""
    x = y[int(a * sr):int(b * sr)].astype(np.float64)
    x = x - x.mean()
    if len(x) < 4 * sr / coarse: return coarse
    ac = np.correlate(x, x, 'full')[len(x) - 1:]
    lag = sr / coarse
    lo, hi = int(lag * 0.94), int(lag * 1.06) + 2
    k = lo + int(np.argmax(ac[lo:hi]))
    p, q, r = ac[k - 1], ac[k], ac[k + 1]
    den = p - 2 * q + r
    k = k + (0.5 * (p - r) / den if den != 0 else 0)
    return sr / k

def octave_fix(y, sr, a, b, f):
    """Guard against pYIN octave errors without using the target pitch:
    among f/2, f, 2f, 4f take the lowest candidate that actually carries
    energy, i.e. is within 20 dB of the strongest partial in 50-2000 Hz
    (a sung fundamental is never ~30 dB weaker than its harmonics; a
    subharmonic guess sits on the noise floor)."""
    x = y[int(a * sr):int(b * sr)]
    if len(x) < 256: return f
    x = x * np.hanning(len(x))
    S = 20 * np.log10(np.abs(np.fft.rfft(x, 32768)) + 1e-9); fr = np.fft.rfftfreq(32768, 1 / sr)
    top = S[(fr > 50) & (fr < 2000)].max()
    e = lambda hz: S[(fr > hz * 0.985) & (fr < hz * 1.015)].max()
    for c in (f / 2, f, f * 2, f * 4):
        if 45 <= c <= 1000 and e(c) > top - 20: return c
    return f

errs, bad, rows = [], 0, []
for n in T['truth']:
    t0, t1 = n['t0'] + lead, n['t1'] + lead
    d = t1 - t0
    m = (times >= t0 + 0.2 * d) & (times <= t1 - 0.2 * d) & voiced
    if m.sum() < 2:
        rows.append(f"{n['text']:>10} {name(n['midi']):>4}  (unvoiced/too short)"); continue
    coarse = octave_fix(y, sr, t0 + 0.2 * d, t1 - 0.2 * d, float(np.median(f0[m])))
    hz = refine(y, sr, t0 + 0.2 * d, t1 - 0.2 * d, coarse)
    cents = 1200 * np.log2(hz / (440 * 2 ** ((n['midi'] - 69) / 12)))
    errs.append(cents)
    flag = abs(cents) > a.tol
    bad += flag
    rows.append(f"{t0:7.2f}s {n['text']:>10} {name(n['midi']):>4} target {440*2**((n['midi']-69)/12):7.2f} Hz  sung {hz:7.2f} Hz  {cents:+6.1f} c {'<-- OFF' if flag else ''}")
if not a.quiet: print('\n'.join(rows))
e = np.abs(errs)
print(f"notes measured: {len(errs)}/{len(T['truth'])}  distinct pitches: {len(set(n['midi'] for n in T['truth']))}  "
      f"mean |err| {e.mean():.1f} c  max |err| {e.max():.1f} c  off-pitch (> {a.tol:g} c): {bad}")
sys.exit(1 if bad else 0)
