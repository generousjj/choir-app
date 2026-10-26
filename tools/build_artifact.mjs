// Package the built app (dist/) as a claude.ai Artifact: one HTML page with
// the JS and CSS inlined (the viewer only loads scripts from a few CDNs) plus
// the data files it fetches with relative URLs.
//   npm run build && node tools/build_artifact.mjs   → artifact/
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const out = 'artifact';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const jsFile = /<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/.exec(html)?.[1];
const cssFile = /<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/.exec(html)?.[1];
if (!jsFile || !cssFile) throw new Error('could not find built JS/CSS in dist/index.html');
const js = readFileSync(join(dist, jsFile), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(dist, cssFile), 'utf8');
const fonts = /<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)"/.exec(html)?.[1];
const page = [
  '<title>Candlelight Part Practice</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts ? `<link rel="stylesheet" href="${fonts}">` : '',
  `<style>${css}</style>`,
  "<script>window.__CPP_ASSETS = 'b64';</script>",
  '<div id="root"></div>',
  `<script type="module">${js}</script>`,
].join('\n');
writeFileSync(join(out, 'index.html'), page);
const files = {};
for (const dir of ['voices', 'dict', 'wasm', 'songs']) {
  cpSync(join(dist, dir), join(out, dir), { recursive: true });
  const walk = (d) => readdirSync(join(out, d), { withFileTypes: true }).forEach((e) => {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) return walk(p);
    if (p.endsWith('.gz')) {
      // binary → base64 text (the host serves only web media types)
      writeFileSync(join(out, p + '.b64.txt'), readFileSync(join(out, p)).toString('base64'));
      rmSync(join(out, p));
      files[p + '.b64.txt'] = join(out, p + '.b64.txt');
    } else {
      if (/\.(musicxml|xml)$/.test(p)) {
        // the host refuses XML with DTD declarations; the app's parser doesn't need it
        const x = readFileSync(join(out, p), 'utf8').replace(/<!DOCTYPE[^>]*>\s*/i, '');
        writeFileSync(join(out, p), x);
      }
      files[p] = join(out, p);
    }
  });
  walk(dir);
}
writeFileSync(join(out, 'files.json'), JSON.stringify(files, null, 1));
console.log(`artifact/index.html ${(page.length / 1024).toFixed(0)} KB, ${Object.keys(files).length} data files`);
