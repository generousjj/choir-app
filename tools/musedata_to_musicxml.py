"""Convert a CCARH MuseData score (e.g. Handel, Messiah HWV 56, Chrysander
edition) to MusicXML, repairing lyric metadata that music21's MuseData reader
gets wrong:

* "Hal-" (hyphen after) is read as syllabic=begin for *every* hyphenated
  syllable; we recompute begin/middle/end/single from the hyphen chain.
* A lone "-" (melisma continuation inside a hyphenated word) becomes an empty
  lyric; we remove it so the previous syllable is sustained over those notes.
* MuseData's "Allegro = 132" is a playback default, not an editorial tempo, so
  we keep only the word "Allegro".

usage: python tools/musedata_to_musicxml.py in.md out.musicxml --title ... --composer ...
"""
import argparse, copy, sys
import music21 as m

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--title', default=''); ap.add_argument('--composer', default='')
ap.add_argument('--keep-tempo', action='store_true')
a = ap.parse_args()

s = m.converter.parse(a.src, format='musedata')

fixed = 0
for p in s.parts:
    in_word = False
    for n in p.recurse().notes:
        if not n.lyrics:
            continue
        ly = n.lyrics[0]
        raw = ly.text or ''
        if raw.strip() in ('', '-', '_'):
            n.lyrics = []  # melisma continuation
            fixed += 1
            continue
        # "jah,Hal-": two syllables (end of one word, start of the next) under
        # one note — write it as an elision with an undertie.
        import re as _re
        if _re.search(r"[A-Za-z][,;:!.?]+[A-Za-z]", raw):
            ly.text = _re.sub(r"([,;:!.?]+)(?=[A-Za-z])", "\\1\u203f", raw)
            fixed += 1
        # music21 sets 'begin' when the MuseData text ends in a hyphen
        hyphen_after = ly.syllabic in ('begin', 'middle')
        new = ('middle' if hyphen_after else 'end') if in_word else ('begin' if hyphen_after else 'single')
        if new != ly.syllabic:
            fixed += 1
        ly.syllabic = new
        in_word = hyphen_after

if not a.keep_tempo:
    marks = list(s.recurse().getElementsByClass('MetronomeMark'))
    text = next((mm.text for mm in marks if mm.text), None)
    for mm in marks:
        mm.activeSite.remove(mm)
    if text:
        s.parts[0].getElementsByClass('Measure')[0].insert(0, m.tempo.TempoText(text))

s.metadata = s.metadata or m.metadata.Metadata()
if a.title: s.metadata.title = a.title
if a.composer: s.metadata.composer = a.composer
s.write('musicxml', fp=a.dst)
print(f"wrote {a.dst}: {len(s.parts)} parts, {len(s.parts[0].getElementsByClass('Measure'))} measures, {fixed} lyric fixes", file=sys.stderr)
