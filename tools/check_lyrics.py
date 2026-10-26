"""Does the rendered audio contain the lyrics, in the right places?

Splits a render (wav + json from tools/render.ts) into phrase windows at
rests, transcribes each window with Whisper (sherpa-onnx) and aligns the
recognized words with the expected words of that window.

usage: python tools/check_lyrics.py MODEL_DIR render.wav [--max 20]
Reports per-window expected vs heard text and word accuracy (1 - WER).
Because each window is cut from the same timeline the UI uses for lyric
highlighting, a high per-window score also confirms the lyric timing.
"""
import sys, json, re, argparse, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, soundfile as sf
from asr import recognizer

ap = argparse.ArgumentParser(); ap.add_argument('model'); ap.add_argument('wav'); ap.add_argument('--max', type=float, default=12)
ap.add_argument('--gap', type=float, default=0.45)
a = ap.parse_args()
J = json.load(open(a.wav[:-4] + '.json'))
syl = J['syllables']
# words with times (group syllables by word index)
W = []
for s in syl:
    if W and W[-1]['wi'] == s['wi']:
        W[-1]['t1'] = s['t1']
    else:
        W.append({'wi': s['wi'], 'w': s['word'].replace('\u203f', ' '), 't0': s['t0'], 't1': s['t1'], 'm': s['m']})
# phrase windows: break at gaps > 0.35 s, keep windows <= max seconds
wins, cur = [], []
for w in W:
    if cur and (w['t0'] - cur[-1]['t1'] > a.gap or w['t1'] - cur[0]['t0'] > a.max):
        wins.append(cur); cur = []
    cur.append(w)
if cur: wins.append(cur)
import unicodedata
def norm(t):
    t = ''.join(c for c in unicodedata.normalize('NFD', t) if not unicodedata.combining(c))  # noël → noel
    return [x for x in re.sub(r"[^a-z' ]", ' ', t.lower().replace('-', '')).split() if x]
def canon(w):
    w = w.replace("'", '')
    if re.fullmatch(r'hal+e?lu[jy]ah?s?|alleluia', w): return 'hallelujah'
    return {'lords': 'lords', 'reign': 'reign', 'forever': 'for ever'}.get(w, w)
def toks(ws): return ' '.join(canon(x) for x in ws).split()
def wer(ref, hyp):
    d = np.zeros((len(ref) + 1, len(hyp) + 1), int); d[:, 0] = range(len(ref) + 1); d[0, :] = range(len(hyp) + 1)
    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            d[i, j] = min(d[i-1, j] + 1, d[i, j-1] + 1, d[i-1, j-1] + (ref[i-1] != hyp[j-1]))
    return d[-1, -1]
y, sr = sf.read(a.wav, dtype='float32')
rec = recognizer(a.model)
def lcs(a, b):
    d = np.zeros((len(a) + 1, len(b) + 1), int)
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i, j] = d[i-1, j-1] + 1 if a[i-1] == b[j-1] else max(d[i-1, j], d[i, j-1])
    return d[-1, -1]
E = N = HIT = 0
for win in wins:
    t0 = max(0, win[0]['t0'] - 0.25); t1 = win[-1]['t1'] + 0.3
    def run(a0, a1):
        st = rec.create_stream(); st.accept_waveform(sr, y[int(a0 * sr):int(a1 * sr)]); rec.decode_stream(st)
        return st.result.text
    heard = run(t0, t1)
    # Whisper sometimes labels a clip "(singing)"/"(music)" instead of
    # transcribing it; retry with the window shifted slightly.
    for shift in (0.15, -0.15, 0.3):
        if norm(heard) and norm(heard)[0] not in ('singing', 'music', 'sings'): break
        heard = run(max(0, t0 + shift), t1 + shift)
    ref = toks(norm(' '.join(w['w'] for w in win))); hyp = toks(norm(heard))
    e = wer(ref, hyp); E += e; N += len(ref); HIT += lcs(ref, hyp)
    print(f"m.{win[0]['m']:>3}-{win[-1]['m']:<3} acc {max(0, 1 - e / max(1, len(ref))):4.0%} | expected: {' '.join(ref)}\n{'':14}| heard:    {' '.join(hyp)}")
print(f"\nOVERALL word accuracy {max(0, 1 - E / N):.1%} over {N} words ({len(wins)} windows)")
print(f"OVERALL word recall {HIT / N:.1%} (expected words heard in order; ignores ASR insertions/hallucinated repeats)")
