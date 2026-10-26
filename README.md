# Candlelight Part Practice

A choir part-learning app that **sings your part with the real words at the
exact pitches and rhythms of the score**. Pick a song, pick Soprano / Alto /
Tenor / Bass-Baritone, press Play. Slow it down, loop a phrase, follow the
highlighted lyrics or the sheet music.

The singing is synthesized on your device (phone included). It is not a
recording and not AI-generated: each syllable is turned into English phonemes
and sung by a diphone synthesizer (MBROLA) at the note's pitch for the note's
duration. The same score always produces the same audio, sample for sample.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173 (also on your LAN: see the "Network" URL)
npm test             # engine unit tests (parser, aligner, phonemizer, singer, full render)
node tests/e2e.mjs   # browser test: play, pause, tempo, loop, jump, import (needs the dev server)
npm run build        # static site in dist/
```

The app is a static site. It needs no server-side code, so it can be hosted anywhere
over HTTPS; `tools/build_artifact.mjs` packages it as a claude.ai Artifact.

## How it works

```
MusicXML ─▶ parse ─▶ voices ─▶ align ─▶ phonemize ─▶ sing ─▶ MBROLA ─▶ mix ─▶ <audio>
           musicxml   voices    align    phonemizer   singer   (wasm)    mix     player
```

| Stage | File | What it does |
|---|---|---|
| Score parsing | `src/engine/musicxml.ts` | Partwise MusicXML and `.mxl`: chords, voices, staves, ties, transposition, lyrics (verses, elisions), tempo, repeats and voltas (verse *n* on pass *n*) |
| Voice extraction | `src/engine/voices.ts` | Finds every line with lyrics and labels it S/A/T/B by part name, by position on a shared staff (closed score), or by range; divisi chords give upper/lower lines |
| Note–lyric alignment | `src/engine/align.ts` | Syllables, melismas, tied notes, words from hyphenation; flags notes with no lyric |
| Phonemes | `src/engine/phonemizer.ts`, `phonetize.ts` | CMU Pronouncing Dictionary (ARPAbet), a choral diction lexicon ("ahnd", "Hah-leh-loo-yah"), archaic forms (-eth, -est), spelling rules as a last resort; splits each word's phonemes over its sung syllables |
| Singing | `src/engine/singer.ts` | Writes MBROLA instructions: exact duration and pitch per phoneme. Vowels start on the beat and hold the note; closing consonants move to the end of the note and are sung with the next onset ("f-o rth-e l-o rdg-o d-om…"); measured voicing delays (aspiration after p/t/k) are absorbed before the beat |
| Synthesis | `wasm/`, `src/engine/mbrola.ts` | MBROLA 3.4 compiled to WebAssembly (asm.js fallback), with two local patches: fractional pitch periods and a singing time-warp (see below) |
| Playback | `src/app/player.ts` | WAV in an `<audio>` element. It plays with the iPhone silent switch on and with the screen locked. Loops are seamless looping clips |
| UI | `src/app/*` | React. Tempo, loop, jump, synced lyrics, sheet music (OpenSheetMusicDisplay), mixer, download, import, review and corrections |

### MBROLA patches (`wasm/patches/`)

Stock MBROLA is built for speech. Two changes make it sing in tune and on time:

1. **Fractional pitch periods.** Stock MBROLA rounds every pitch period down to
   a whole number of samples. Notes come out up to 25 cents sharp, and any
   pitch movement turns into audible steps. The patch carries the fraction
   from one period to the next, so a note's mean pitch is exact.
2. **Singing time-warp.** A sung vowel can be 20 times longer than a spoken one. Stock
   MBROLA stretches all recorded frames evenly, which stretches the breath after a
   "k" or "p" into hundreds of milliseconds ("khhhh-ing") and smears the
   transition into the next consonant. The patch keeps unvoiced and transient frames at their
   natural length and lengthens only the steady vowel frames.

## Verification (Hallelujah, bass part, full movement)

| Check | Tool | Result |
|---|---|---|
| Notes match the source edition | `tools/crosscheck_musedata.py` | all 1,489 S/A/T/B notes identical to the CCARH MuseData source (onset, duration, pitch, syllable) |
| Source plausibility | `tools/score_sanity.py` | 94 complete measures; every word in the libretto; sung bass matches the continuo bass on 400/402 notes; 91% of SATB sonorities consonant |
| Pitch accuracy | `tools/verify_pitch.py` | 409/409 notes measured, mean error 1.5 cents, max 20 cents |
| Notes start on time | `tools/pitch_trace.py` | 90% of notes reach pitch within 30 ms of the beat |
| Words are intelligible | `tools/check_lyrics.py` (Whisper small.en, offline) | 92.6% of the 215 sung words recognized in the right phrase window |
| Browser plays the verified audio | `tests/e2e.mjs` + `tools/mix_render.ts` | audio captured from the page is byte-identical to the offline render |
| Reproducible | `tools/check_determinism.ts`, unit tests | repeated renders are bit-identical |

### Judging it by ear

Automated checks can't tell you whether it *sounds right to you*. Try this:

1. Play Bass at 100% from m.12, "For the Lord God omnipotent reigneth". You should
   hear every word, and the octave leap on "God om-" should land on the beat.
2. Loop m.33–35, "The kingdom of this world", at 75% and sing along. The vowel
   should change exactly where your conductor would cut it off.
3. Turn on "Piano doubling your notes". Voice and piano should agree on
   every note. A sour note means a pitch problem; report the measure number.
4. If a word sounds wrong, open **Check & correct**, find the measure, and type a
   pronunciation (ARPAbet, e.g. `R EY1 N AH0 TH`).

## Adding your Candlelight pieces

* **MusicXML from your section leader or from notation software**: use "Add a score".
  The file stays in your browser's storage on that device.
* **Photos or PDFs of your folder**: see [docs/OMR.md](docs/OMR.md) for the transcription workflow.
  Today you can scan with an OMR app (e.g. Audiveris, PlayScore 2, Newzik) that exports MusicXML, then import it and fix errors in "Check & correct".
* The Candlelight arrangements (public/songs/candlelight/) are copyrighted and are included here by the owner's choice;
  edit the transcription .txt files and run `python3 -I tools/publish_candlelight.py` to rebuild them.

## Licenses

* MBROLA engine: AGPL-3.0 (`public/wasm/MBROLA-LICENSE-AGPL3.txt`). Source: github.com/numediart/MBROLA, patches in `wasm/patches/`.
* MBROLA US voices us1/us2/us3: free for non-commercial use with MBROLA (`public/voices/LICENSE-us-voices.txt`).
* CMU Pronouncing Dictionary: BSD-style (`public/dict/CMUDICT-LICENSE`).
* Hallelujah: Handel (public domain); encoding © CCARH, research/non-commercial use.
* App code: AGPL-3.0, because it is distributed together with MBROLA.
