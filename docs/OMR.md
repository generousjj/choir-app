# From a photo of the score to a sung part (Milestone 5 design)

Goal: photograph or scan a Candlelight Choir page, get the baritone line
with its lyrics, check it, and practise it. Optical music recognition (OMR)
makes mistakes, especially with lyrics, ties, and small print, so the
design treats the transcription as a **draft to review**.

## Pipeline

```
photo / PDF ─▶ OMR engine ─▶ MusicXML + confidence ─▶ import ─▶ review & correct ─▶ sing
               (server)       (per note, per lyric)     (exists)   (extends existing)
```

1. **Upload.** The app accepts JPEG/PNG/HEIC/PDF (`<input type=file accept="image/*,.pdf">`).
   On iPhone the camera works directly from the file picker.
2. **Transcribe.** Run an OMR engine and get MusicXML back. Candidates:
   * **Audiveris** (AGPL, Java): the most complete open-source engine. It
     reads lyrics with Tesseract, handles multi-page PDFs, and exports MusicXML. It runs as a
     command (`audiveris -batch -export -output out/ score.pdf`) in a small container.
   * **homr / oemer** (MIT, deep learning): good on photos of single staves,
     but no lyrics yet, so they would need a separate OCR pass for the text.
   * Commercial apps (PlayScore 2, Newzik, ScanScore) export MusicXML that
     the app already imports. This is the option available today.

   OMR needs a server: these engines don't run on a phone. The service would expose
   `POST /omr` (file) → `{ musicxml, confidence: [...], pages: [image urls] }`.
3. **Import.** The result goes through the existing MusicXML parser. The
   parser already reports warnings: incomplete measures, notes without lyrics,
   syllables that continue a word that never started.
4. **Pick the voice.** `singableLines()` already handles separate parts,
   closed score (two voices on one staff, ranked by register) and divisi
   chords (upper/lower). For a TTBB or SATB score you choose "Bass" or
   "Baritone" (upper bass divisi) and the app remembers it per song.
5. **Review & correct.** Extends the existing "Check & correct" panel:
   * already there: lyric text, pronunciation, flags for dictionary misses and
     notes without lyrics, jump-to-measure;
   * to add for OMR: pitch and duration editing per note, a crop of the
     source image beside each measure, low-confidence highlights, and a
     "measure doesn't add up" checker (sum of durations vs time signature);
   * corrections are stored as a patch keyed by measure and note (not by
     editing the file), so re-running OMR on a better photo keeps the fixes
     that still apply.
6. **Sing.** Unchanged: the corrected score goes through the same engine.

## Data model hooks (already in place)

* `Score`, `VoiceLine`, `NoteEvent`, `Lyric` (`src/engine/types.ts`) are plain
  JSON, so an OMR service, the review UI and the singer all share one format.
* `Score.warnings` and `SungLine.warnings` carry problems found during import.
* `RenderOptions.textOverrides` / `overrides` apply lyric and pronunciation
  fixes without touching the source. Note-level fixes would add
  `noteOverrides: Record<eventKey, {pitch?, durQ?}>` in the same way.
* To add: `NoteEvent.confidence?: number` and
  `NoteEvent.sourceBox?: {page, x, y, w, h}` for highlights and image crops.

## Verification for transcribed scores

What already exists, and applies to imported scores too:

* measure-duration checks, lyric/note counts per line, flagged words;
* the piano doubling makes wrong notes easy to hear;
* `tools/verify_pitch.py` and `tools/check_lyrics.py` work on any render.

What to add for OMR:

* side-by-side playback of the corrected line vs the original OMR line;
* a "confirmed" tick per measure, so you can track how much of a piece you
  have checked against the paper copy.
