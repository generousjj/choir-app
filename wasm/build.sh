#!/bin/sh
# Build MBROLA as WebAssembly.  usage: wasm/build.sh /path/to/MBROLA-source
# Requires emscripten (apt install emscripten). Outputs src/engine/wasm/mbrola.{mjs,wasm}
# and a CommonJS variant for Node tests in wasm/dist/.
set -e
SRC=${1:?path to MBROLA source}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/../src/engine/wasm
mkdir -p "$OUT" "$HERE/dist" "$HERE/obj"
# Work on a copy so local modifications are explicit:
#  * Parser/phonbuff.c: .pho line buffer 1024 → 65536 bytes, so a long sung
#    vowel can carry a dense pitch contour (vibrato, melisma) on one line.
WORK=$(mktemp -d)
cp -r "$SRC"/. "$WORK"
cd "$WORK"
sed -i 's/char a_line\[1024\];/char a_line[65536];/' Parser/phonbuff.c
grep -q 'a_line\[65536\]' Parser/phonbuff.c || { echo 'patch failed' >&2; exit 1; }
#  * Engine/diphone.c: fractional pitch periods (wasm/patches/*.patch)
#  * Engine/mbrola.c: singing time-warp (the steady centre of a vowel absorbs long
#    notes) and phone split (a long phone's extra time goes to the half with steady frames)
#  * Engine/diphone.h: NBRE_PM_MAX 2000 → 20000 synthesis frames per diphone
#    (long notes at slow practice tempos)
for p in "$HERE"/patches/*.patch; do patch -p1 < "$p"; done
sed -i 's/#define NBRE_PM_MAX\t2000/#define NBRE_PM_MAX\t20000/' Engine/diphone.h
grep -q 'NBRE_PM_MAX.20000' Engine/diphone.h || { echo 'NBRE_PM_MAX patch failed' >&2; exit 1; }
FLAGS="-O2 -DLITTLE_ENDIAN -I Engine -I Parser -I Misc -I Database -I Standalone"
for f in Engine/mbrola.c Engine/diphone.c Parser/phone.c Parser/parser_input.c Parser/input_file.c \
         Parser/phonbuff.c Misc/audio.c Misc/vp_error.c Misc/mbralloc.c Misc/common.c Database/database.c \
         Database/database_old.c Database/diphone_info.c Database/little_big.c Database/hash_tab.c Database/zstring_list.c; do
  emcc $FLAGS -c "$f" -o "$HERE/obj/$(echo "$f" | tr / _).o" 2>/dev/null
done
emcc $FLAGS -Dmain=mbrola_main -c Standalone/synth.c -o "$HERE/obj/synth.o" 2>/dev/null
emcc $FLAGS -c "$HERE/mbrola_wasm.c" -o "$HERE/obj/mbrola_wasm.o"
LINK="-O2 $HERE/obj/*.o -lm -sMODULARIZE=1 -sEXPORT_NAME=createMbrola -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 \
  -sFORCE_FILESYSTEM=1 -sEXPORTED_FUNCTIONS=['_run_mbrola'] -sEXPORTED_RUNTIME_METHODS=['FS','ccall']"
emcc $LINK -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -o "$OUT/mbrola.mjs"
emcc $LINK -sENVIRONMENT=node -o "$HERE/dist/mbrola-node.cjs"
ls -la "$OUT" "$HERE/dist"
# Pure-JavaScript (asm.js) fallback for hosts whose Content-Security-Policy
# forbids WebAssembly compilation. Same C code, same output, slower.
emcc $LINK -sWASM=0 -sSINGLE_FILE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -o "$OUT/mbrola-asm.mjs"
emcc $LINK -sENVIRONMENT=node -o "$HERE/dist/mbrola-node.cjs"
cp "$OUT/mbrola.wasm" "$HERE/../public/wasm/mbrola.wasm"
ls -la "$OUT/mbrola-asm.mjs"
