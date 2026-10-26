"""Build public/songs/candlelight/ (gitignored: copyrighted arrangements) from the transcriptions kept there.

Each song folder holds transcription.txt (the men's line) and optionally S.txt, A.txt, T.txt (the other
parts, same measure lines). They are converted into one score.musicxml, and catalog.json is rewritten.
    python3 -I tools/publish_candlelight.py
"""
import json, os, subprocess, re
APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = f'{APP}/public/songs/candlelight'
SONGS = [  # id, title (fallback; the transcription's title: line wins)
    ('first_noel', 'The First Noel'), ('candlelight_carol', 'Candlelight Carol'), ('he_is_born', 'He Is Born (Il Est Né)'),
    ('candlelight_processional', 'Candlelight Processional'), ('sing_praise', 'Sing Praise To Him Our Lord'),
    ('angels', 'Angels We Have Heard On High'), ('what_child', 'What Child Is This'), ('we_three_kings', 'We Three Kings'),
    ('joy_to_the_world', 'Joy To The World'), ('silent_night', 'Silent Night'), ('sing_noel', 'Sing Noël'),
]
LEX = {'he_is_born': {
    # French refrain, as on the singer's sheet: "i lɛ ne, lə divi nɑ̃fɑ̃ / ʒu e o bwa, re zɔ ne my zɛ tə /
    # i lɛ ne, lə divi nɑ̃fɑ̃ / ʃɑ̃ tɔ̃ tu sɔ̃ na vɛ nə mɑ̃". Nasal vowels have no inner n; a final n links
    # to the next word (divi-n‿enfant, son‿avènement).
    'il': 'IY1 L', 'est': 'EH1', 'ne': 'N EY1', 'le': 'L AH0', 'divin': 'D IY0 V IY1 N', 'enfant': 'AA0 F AA1 N',
    'jouez': 'ZH UW0 EY1', 'hautbois': 'OW0 B W AA1', 'resonnez': 'R EY0 Z AO0 N EY1', 'musettes': 'M UW0 Z EH1 T AH0',
    'chantons': 'SH AA0 T AO1 N', 'tous': 'T UW1', 'son': 'S AO1 N', 'avenement': 'AA0 V EH1 N AH0 M AA1 N'}}
PART_ORDER = ['S.txt', 'A.txt', 'T.txt', 'transcription.txt']
cat, bad = [], 0
for sid, title in SONGS:
    d = f'{OUT}/{sid}'
    srcs = [f'{d}/{f}' for f in PART_ORDER if os.path.exists(f'{d}/{f}')]
    if not os.path.exists(f'{d}/transcription.txt'):
        print('missing', sid); continue
    head = open(f'{d}/transcription.txt', encoding='utf8').read()
    meta = dict(re.findall(r'^(title|composer)\s*:\s*(.*)$', head, re.M))
    r = subprocess.run(['python3', '-I', f'{APP}/tools/notation_to_musicxml.py', f'{d}/score.musicxml', '--parts', *srcs], capture_output=True, text=True)
    print(sid, '|', r.stderr.strip().replace('\n', '\n    '))
    bad += r.returncode != 0
    cat.append({'id': sid, 'title': meta.get('title') or title,
                'subtitle': 'Disneyland Candlelight — transcribed from your folder' + (' (all parts)' if len(srcs) > 1 else " (men's part)"),
                'composer': meta.get('composer', ''), 'file': f'songs/candlelight/{sid}/score.musicxml',
                'source': 'Hand transcription from the singer\'s folder photos.',
                'license': 'Copyrighted arrangement; private practice copy.', **({'lexicon': LEX[sid]} if sid in LEX else {})})
json.dump({'songs': cat}, open(f'{OUT}/catalog.json', 'w'), indent=1, ensure_ascii=False)
print(len(cat), 'songs in catalog;', bad, 'with problems')
