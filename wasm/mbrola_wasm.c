/* WebAssembly entry point for MBROLA (AGPL-3.0, https://github.com/numediart/MBROLA).
 * Standalone/synth.c is compiled with -Dmain=mbrola_main; this wrapper lets
 * JavaScript run the synthesizer repeatedly on files in the in-memory FS. */
#include <emscripten.h>
#include <getopt.h>

int mbrola_main(int argc, char **argv);
extern float mbr_period_residual; /* wasm/patches/01-fractional-pitch-period.patch */

EMSCRIPTEN_KEEPALIVE
int run_mbrola(const char *voice, const char *pho, const char *out)
{
	char *argv[] = { "mbrola", "-e", (char *)voice, (char *)pho, (char *)out, 0 };
	optind = 1; /* getopt state must be reset between calls */
	mbr_period_residual = 0.0f; /* every run starts from the same state: reproducible audio */
	return mbrola_main(5, argv);
}
