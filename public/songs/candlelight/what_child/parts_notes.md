# What Child Is This? (Duet Version) – S/A/T parts

Files: S.txt (Soprano), A.txt (Alto), T.txt (Tenor). They use the same measure lines, headers and
directions as transcription.txt (m1-42, no repeats). gen/make.py builds them from the bass file.
Check: `notation_to_musicxml.py ... --parts S A T B` gives 4 parts, 42 measures, 381 notes, 0 problems.

## Sources and layout
- B-008 right page (m1-12) and B-009 both pages (m13-42). Both photos were rotated, and each staff was dewarped
  with ../tools/dewarp.py.
- The choir has an S/A treble staff and a T/B bass-clef staff. S = up-stem voice and A = down-stem voice.
  T = up-stem voice on the T/B staff, written at sounding pitch.
- The choir is tacet in m1-6 and m19-25 (whole-measure rests). m26 ends with the pickup "So" on F4 (S and A in
  unison) and F3 (T, in unison with B).
- m27-28 (up to "ooh"): the whole choir sings one unison melody. S and A sing it an octave above T/B.

## Solo / duet lines left out
- The Solo Female and Solo Male staves above the choir carry the duet in m1-18 and m27-42. The handbells are on
  the Solo Female staff in m1-2. All the solo staves have the same 7-bar rest as the choir in m19-25.

## Lyrics
- As printed: "lu" (m7-10), "oh" (m10), "ooh" (m28-34 and m36-38). The S/A 16th passing notes are melismas.
- The Candlelight Carol adaptations ("Hum" sung as "Oo", the held "child") do not apply here: these words do not
  occur in this song.

## Doubts
1. **m35-36 and m39-40: soprano divisi.** At "Raise, raise the", "Joy, joy for", "song" and "Christ" the up-stem
   voice has two noteheads (C5+Eb5, then Bb4+Dn5, then Ab4+C5, then G4+Bb4). The down-stem voice has one
   (G4, Ab4, Eb4, Dn4). I wrote the soprano as chords (lower note first). The upper staff could also be meant as
   S / A1 / A2. In that case the alto would take the lower chord note.
2. **m14 "sing": every part has B3.** S and A share one B3 dotted quarter below the C4 ledger line, and T/B share
   B3 as well. This is low for sopranos, but it is clearly printed. It also supports the bass reading of B3 here
   (bass notes, doubt 1).
3. **m17: the S/A line sits low** under "dim.": soprano down to C#4 and alto down to A3. It reads clearly.
4. **m16 alto "the" = D#4.** No sharp is printed on the alto note. The sharp comes from the soprano's D#4 ("laud")
   earlier in the same measure on the shared staff, so I applied it.
5. **m41, second half: three eighths, not a dotted figure.** I found no 16th beam stub. Soprano En4 Dn4 En4 and alto
   C4 Bb3 C4. I read one natural before the second chord (on D) and none on the B, so the alto has Bb3.
6. **m41 tenor "Babe" = C4** over bass Db3 (a Db major-seventh sound). Its notehead sits between C4 and Db4, and
   the staff lines put it nearer C4.
7. **m30 alto: F4 quarter, then En4 eighth,** then E4 quarter (with S G4) and "The" on F4. I saw no dot on the
   first F4.
8. **m10 beat 1:** only one notehead per staff (E4 for S/A and E3 for T/B), so it is a unison for each pair.
   Tenor "oh" G3 B3 E4 sits above the bass's E3 G3 B3.
9. **m36 tenor:** quarter G3 ("high") plus eighth G3 ("ooh"), with no 16th. The S/A have the dotted figure here.
   In m40 the tenor does have the dotted figure (G3, Ab3 16th, Bb3).

## Bass file (transcription.txt)
- I found no errors. The bass readings flagged in notes.md (m14 B3, m32 Eb3, m40 G3, m35/m39 C4) all fit the
  upper parts' harmony.

## Ranges
- Soprano B3–Eb5 (B3 only in m14), Alto A3–Db5, Tenor Eb3–E4.
