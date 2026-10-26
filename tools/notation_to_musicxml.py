"""Convert a hand transcription (one measure per line) to MusicXML.

Usage:  notation_to_musicxml.py IN.txt OUT.musicxml
        notation_to_musicxml.py OUT.musicxml --parts S.txt A.txt T.txt B.txt   (one score, several parts;
        every part file must list the same measures in the same order)

Used for scores transcribed from photos/PDFs: the text is easy to proofread
against the page, and every measure is checked against its time signature.

Format
------
    title: Sing Noël
    composer: Brent Pierce
    part: Bass
    key: -1                 # sharps (+) / flats (-) in the key signature
    time: 6/8
    tempo: 127.5            # quarter notes per minute (may change mid-piece)
    text: 3/4 (♪=♪)         # direction text shown at the next measure

    <measure-number>: <token> <token> ...      # comments start with '# '

Measures are written in PERFORMANCE order (repeats already unrolled), so a
repeated measure simply appears again with the same number.

Token:  PITCH/DUR[:LYRIC]
    PITCH  C4, F#3, Bb2, Eb3, Bn3 (n = natural), r = rest. By default accidentals
           are explicit (C4 is always C natural). With 'spelling: page', pitches
           are written as printed: the key signature and accidentals earlier in
           the same measure apply, exactly as when reading the score.
           several pitches joined with + for divisi (G2+D3)
    DUR    1 2 4 8 16 32, dots appended (4.), 'd' = duplet in compound
           time (8d = two eighths in the time of three), 't' = triplet,
           '~' at the end ties to the next note
    LYRIC  'Sav-' (hyphen follows), '-ior' (continues a word),
           '-' alone or omitted = melisma / no new syllable, '_' joins two
           words under one note (elision)
    Extra:  fermata suffix '!'  (e.g. D3/2.!)
"""
import re, sys
from fractions import Fraction as F
import music21 as m

BASE = {'1': F(4), '2': F(2), '4': F(1), '8': F(1, 2), '16': F(1, 4), '32': F(1, 8)}


def dur_of(s):
    mm = re.fullmatch(r'(1|2|4|8|16|32)(\.*)([dt]?)', s)
    if not mm:
        raise ValueError(f'bad duration {s!r}')
    d = BASE[mm.group(1)]
    add = d
    for _ in mm.group(2):
        add /= 2
        d += add
    if mm.group(3) == 'd':
        d = d * F(3, 2)
    if mm.group(3) == 't':
        d = d * F(2, 3)
    return d


SHARPS, FLATS = 'FCGDAEB', 'BEADGCF'
ALTER = {'': None, '#': 1, '##': 2, 'b': -1, 'bb': -2, 'n': 0}


def spell(p, key, measure_acc, page):
    """Token pitch → music21 pitch name, applying key/measure accidentals in page mode."""
    mm = re.fullmatch(r'([A-G])(##|bb|[#bn])?([0-9])', p)
    if not mm:
        raise ValueError(f'bad pitch {p!r}')
    letter, acc, octv = mm.group(1), mm.group(2) or '', mm.group(3)
    alt = ALTER[acc]
    if page:
        if alt is not None:
            measure_acc[(letter, octv)] = alt
        else:
            alt = measure_acc.get((letter, octv))
            if alt is None:
                alt = 1 if key > 0 and letter in SHARPS[:key] else -1 if key < 0 and letter in FLATS[:-key] else 0
    alt = alt or 0
    return letter + {2: '##', 1: '#', 0: '', -1: '-', -2: '--'}[alt] + octv


def clef_for(name, notes):
    """Bass clef for men's low parts, treble-8 for tenors, treble otherwise (by name, else by range)."""
    n = name.lower()
    if re.search(r'bass|bari|men', n): return m.clef.BassClef()
    if 'tenor' in n: return m.clef.Treble8vbClef()
    if re.search(r'sop|alto|women|treble|desc', n): return m.clef.TrebleClef()
    ps = [p.midi for x in notes for p in x.pitches]
    mean = sum(ps) / len(ps) if ps else 60
    return m.clef.BassClef() if mean < 55 else m.clef.Treble8vbClef() if mean < 62 else m.clef.TrebleClef()


def parse_part(src):
    meta = {'title': '', 'composer': '', 'part': 'Voice'}
    part = m.stream.Part()
    order = []
    errors = []
    key = 0
    ts = None
    pending_text = None
    pending_tempo = None
    first = True
    last_ts = None
    last_key = None
    page_spelling = False
    in_word = False
    for ln, raw in enumerate(open(src, encoding='utf8'), 1):
        line = re.split(r'(?:^|\s)#(?:\s|$)', raw.rstrip('\n'), maxsplit=1)[0].rstrip()  # '# comment' (F#3 is a pitch)
        if not line.strip():
            continue
        mh = re.match(r'\s*(title|composer|part|key|time|tempo|text|spelling)\s*:\s*(.*)$', line)
        if mh:
            k, v = mh.group(1), mh.group(2).strip()
            if k in meta: meta[k] = v
            elif k == 'key': key = int(v)
            elif k == 'time': ts = m.meter.TimeSignature(v)
            elif k == 'tempo': pending_tempo = float(v)
            elif k == 'text': pending_text = v
            elif k == 'spelling': page_spelling = v.strip() == 'page'
            continue
        mm = re.match(r'\s*([0-9]+[a-z]?)\s*:\s*(.*)$', line)
        if not mm:
            errors.append(f'line {ln}: cannot parse {line!r}')
            continue
        num, body = mm.group(1), mm.group(2)
        order.append(num)
        meas = m.stream.Measure(number=int(re.match(r'\d+', num).group()))
        meas.numberSuffix = num[len(str(meas.number)):] or None
        if first or key != last_key:  # first measure, or a key change written since the last measure
            meas.insert(0, m.key.KeySignature(key))
            first = False
            last_key = key
        if ts.ratioString != last_ts:
            meas.insert(0, m.meter.TimeSignature(ts.ratioString))
            last_ts = ts.ratioString
        if pending_tempo:
            meas.insert(0, m.tempo.MetronomeMark(number=pending_tempo, referent=m.duration.Duration(1.0)))
            pending_tempo = None
        if pending_text:
            meas.insert(0, m.expressions.TextExpression(pending_text))
            pending_text = None
        total = F(0)
        measure_acc = {}  # (letter, octave) -> alter, for page spelling
        for tok in body.split():
            tm = re.fullmatch(r'([A-Ga-gr](?:##|bb|[#bn])?[0-9]?(?:\+[A-G](?:##|bb|[#bn])?[0-9])*)/([0-9.dt]+)(~?)(!?)(?::(.*))?', tok)
            if not tm:
                errors.append(f'line {ln} m.{num}: bad token {tok!r}')
                continue
            pitch, d, tie, ferm, lyr = tm.groups()
            d = dur_of(d)
            total += d
            if pitch == 'r':
                n = m.note.Rest(quarterLength=d)
            else:
                ps = [spell(p, key, measure_acc, page_spelling) for p in pitch.split('+')]
                n = m.note.Note(ps[0], quarterLength=d) if len(ps) == 1 else m.chord.Chord(ps, quarterLength=d)
                if tie:
                    n.tie = m.tie.Tie('start')
                if ferm:
                    n.expressions.append(m.expressions.Fermata())
                if lyr and lyr.rstrip('-').endswith('_'):
                    errors.append(f'line {ln} m.{num}: "{lyr}" ends with "_" (an elision needs a second word; a melisma needs no mark)')
                if lyr and lyr != '-':
                    hyph_after = lyr.endswith('-')
                    cont = lyr.startswith('-')
                    text = lyr.strip('-').replace('_', '‿')
                    syl = ('middle' if hyph_after else 'end') if (cont and in_word) else ('begin' if hyph_after else 'single')
                    if cont and not in_word:
                        errors.append(f'line {ln} m.{num}: "{lyr}" continues a word that did not start')
                    n.lyrics = [m.note.Lyric(text=text, syllabic=syl)]
                    in_word = hyph_after
            meas.append(n)
        expect = F(ts.barDuration.quarterLength).limit_denominator(64)
        if total != expect and not num.endswith('p'):  # 'p' suffix = pickup / partial measure
            errors.append(f'm.{num}: {float(total)} quarters, expected {float(expect)} ({ts.ratioString})')
        part.append(meas)
    # fix ties: a tie start followed by the same pitch → stop
    notes = list(part.recurse().notes)
    ps = lambda n: sorted(p.midi for p in n.pitches)
    for a, b in zip(notes, notes[1:]):
        if a.tie and a.tie.type in ('start', 'continue') and ps(a) == ps(b):
            b.tie = m.tie.Tie('continue' if (b.tie and b.tie.type == 'start') else 'stop')
    part.partName = meta['part']
    part.insert(0, m.instrument.Vocalist())
    part.getElementsByClass('Instrument')[0].partName = meta['part']
    first_m = part.getElementsByClass('Measure')[0]
    first_m.insert(0, clef_for(meta['part'], notes))
    return part, meta, errors, order, len(notes)


def main(srcs, dst):
    score = m.stream.Score()
    errors, meta0, order0, total = [], None, None, 0
    for src in srcs:
        part, meta, errs, order, nn = parse_part(src)
        errors += [f'{src.split("/")[-1]}: {e}' if len(srcs) > 1 else e for e in errs]
        if order0 is None:
            meta0, order0 = meta, order
        elif order != order0:
            first_diff = next((i for i, (a, b) in enumerate(zip(order, order0)) if a != b), min(len(order), len(order0)))
            errors.append(f'{src}: measure order differs from {srcs[0]} at position {first_diff + 1} '
                          f'({order[first_diff] if first_diff < len(order) else "end"} vs {order0[first_diff] if first_diff < len(order0) else "end"}); '
                          f'{len(order)} vs {len(order0)} measures')
        score.insert(0, part)
        total += nn
    score.metadata = m.metadata.Metadata(title=meta0['title'], composer=meta0['composer'])
    if errors:
        print('\n'.join(errors), file=sys.stderr)
    score.write('musicxml', fp=dst)
    print(f"wrote {dst}: {len(srcs)} part(s), {len(order0)} measures, {total} notes; {len(errors)} problems", file=sys.stderr)
    return 1 if errors else 0


if __name__ == '__main__':
    a = sys.argv[1:]
    if '--parts' in a:
        sys.exit(main(a[a.index('--parts') + 1:], a[0]))
    sys.exit(main([a[0]], a[1]))
