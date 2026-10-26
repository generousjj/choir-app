"""Independent check: compare the app's parse of our MusicXML against
music21's parse of the ORIGINAL MuseData source, note by note.
usage: python tools/crosscheck_musedata.py source.md dump.json"""
import json, sys
import music21 as m
src = m.converter.parse(sys.argv[1], format='musedata')
app = json.load(open(sys.argv[2]))
names = {'S': 'Soprano', 'A': 'Alto', 'T': 'Tenore', 'B': 'Basso'}
ok = True
for role, pname in names.items():
    part = [p for p in src.parts if p.partName == pname][0]
    ref = []
    for n in part.flatten().notes:
        ly = n.lyrics[0].text if n.lyrics and n.lyrics[0].text not in ('', '-', '_') else ''
        ref.append([float(n.offset), float(n.quarterLength), n.pitch.midi, ly, str(n.measureNumber)])
    got = app[role]
    mism = [(i, r, g) for i, (r, g) in enumerate(zip(ref, got))
            if abs(r[0] - g[0]) > 1e-6 or abs(r[1] - g[1]) > 1e-6 or r[2] != g[2] or r[3] != g[3]]
    print(f"{role} ({pname}): source notes {len(ref)}, app notes {len(got)}, mismatches {len(mism)}, "
          f"lyric syllables {sum(1 for r in ref if r[3])}")
    for i, r, g in mism[:5]: print('   ', i, 'source', r, 'app', g)
    ok &= len(ref) == len(got) and not mism
print('IDENTICAL' if ok else 'DIFFERENCES FOUND'); sys.exit(0 if ok else 1)
