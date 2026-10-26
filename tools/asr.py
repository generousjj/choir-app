"""Transcribe audio with Whisper (sherpa-onnx, offline) — an independent check
that the synthesized singing contains the intended words.

usage: python tools/asr.py MODEL_DIR file.wav [file2.wav ...]
MODEL_DIR: sherpa-onnx-whisper-* directory (encoder/decoder onnx + tokens).
Long files are transcribed in windows (Whisper takes ≤30 s at a time).
"""
import sys, glob, os
import numpy as np, soundfile as sf, sherpa_onnx, librosa

def recognizer(model_dir):
    pick = lambda pat: sorted(glob.glob(os.path.join(model_dir, pat)), key=len)[0]
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=pick('*encoder.int8.onnx') if glob.glob(os.path.join(model_dir, '*encoder.int8.onnx')) else pick('*encoder*.onnx'),
        decoder=pick('*decoder.int8.onnx') if glob.glob(os.path.join(model_dir, '*decoder.int8.onnx')) else pick('*decoder*.onnx'),
        tokens=pick('*tokens.txt'), language='en', task='transcribe', num_threads=4)

def transcribe(rec, path, win=25.0, start=0.0, end=None):
    y, sr = sf.read(path, dtype='float32')
    if y.ndim > 1: y = y.mean(axis=1)
    if sr != 16000: y = librosa.resample(y, orig_sr=sr, target_sr=16000); sr = 16000
    y = y[int(start * sr): int(end * sr) if end else None]
    out = []
    for a in range(0, len(y), int(win * sr)):
        s = rec.create_stream(); s.accept_waveform(sr, y[a:a + int(win * sr)])
        rec.decode_stream(s); out.append(s.result.text.strip())
    return ' '.join(out)

if __name__ == '__main__':
    rec = recognizer(sys.argv[1])
    for p in sys.argv[2:]:
        print(f"{os.path.basename(p)}: {transcribe(rec, p)}")
