"""Musical plausibility checks of a SATB score encoding (MuseData or MusicXML).
usage: python tools/score_sanity.py score.(md|musicxml)"""
import sys, re, collections
import music21 as m
path = sys.argv[1]
s = m.converter.parse(path, format='musedata' if path.endswith('.md') else None)
parts = {p.partName: p for p in s.parts}
voc = {r: next(p for n, p in parts.items() if re.match(pat, n or '', re.I)) for r, pat in
       [('S', 'sop'), ('A', 'alt'), ('T', 'ten'), ('B', 'bas')]}
# 1. measure durations
bad = [(r, mm.number, mm.duration.quarterLength) for r, p in voc.items() for mm in p.getElementsByClass('Measure')
       if abs(mm.duration.quarterLength - 4) > 1e-6]
print(f"1. incomplete/overfull measures in vocal parts: {len(bad)} {bad[:5]}")
# 2. libretto vocabulary
LIB = set("hallelujah for the lord god omnipotent reigneth kingdom of this world is become our and his christ he shall reign ever king kings lords".split())
words = collections.Counter()
for r, p in voc.items():
    text = ' '.join((ly.text or '') for n in p.flatten().notes for ly in n.lyrics[:1])
    for tok in re.findall(r"[A-Za-z]+", text.replace('-', '')):
        words[tok.lower()] += 1
outside = {w: c for w, c in words.items() if w not in LIB and w not in {'hal', 'le', 'lu', 'jah', 'om', 'ni', 'po', 'tent', 'eth', 'e', 'ver', 'dom', 'come', 'be'}}
print(f"2. lyric tokens outside the libretto vocabulary: {outside or 'none'}")
# 3. bass vs continuo (Tutti Bassi): pitch-class agreement at bass note onsets
cont = next((p for n, p in parts.items() if 'bassi' in (n or '').lower()), None)
if cont is not None:
    cf = cont.flatten().notes
    agree = tot = 0
    for n in voc['B'].flatten().notes:
        c = [x for x in cf.getElementsByOffset(n.offset, mustBeginInSpan=False, includeElementsThatEndAtStart=False)]
        if not c: continue
        tot += 1
        agree += any(x.pitch.pitchClass == n.pitch.pitchClass for x in c if x.isNote)
    print(f"3. bass notes whose pitch class matches the continuo bass at that moment: {agree}/{tot} ({100*agree/tot:.0f}%)")
# 4. SATB vertical sonorities: fraction of beats where SATB form a consonant (major/minor triad / incomplete) chord
cons = tot = 0
sat = m.stream.Score([voc[r] for r in 'SATB']).chordify()
for c in sat.flatten().getElementsByClass('Chord'):
    if c.quarterLength < 0.5 or len(c.pitches) < 3: continue
    tot += 1
    cons += c.isConsonant() or c.isTriad() or c.isDominantSeventh()
print(f"4. SATB sonorities ≥ eighth note that are triads/consonant/V7: {cons}/{tot} ({100*cons/tot:.0f}%)")
# 5. ranges
for r, p in voc.items():
    ps = [n.pitch for n in p.flatten().notes]
    print(f"5. {r} range {min(ps, key=lambda x: x.midi).nameWithOctave}–{max(ps, key=lambda x: x.midi).nameWithOctave}")
