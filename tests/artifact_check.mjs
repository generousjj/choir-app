// Load the packaged artifact page the way the viewer would (document skeleton
// around artifact/index.html), with and without a CSP that forbids
// WebAssembly, and check that it loads, sings and plays.
//   node tests/artifact_check.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const page = readFileSync('artifact/index.html', 'utf8');
const CSP = "default-src 'self'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:";
const skeleton = (csp) => `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''}<style>:root{color-scheme:light}body{margin:0}</style></head><body>${page}</body></html>`;
const types = { '.json': 'application/json', '.wasm': 'application/wasm', '.musicxml': 'application/xml', '.txt': 'text/plain' };
const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/strict') { res.setHeader('content-type', 'text/html'); return res.end(skeleton(u.pathname === '/strict' ? CSP : '')); }
  const f = join('artifact', decodeURIComponent(u.pathname));
  if (!existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
}).listen(5180);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let ok = true;
for (const path of ['/', '/strict']) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5180' + path);
  try {
    await p.waitForFunction(() => document.querySelector('.status')?.textContent?.startsWith('Ready'), null, { timeout: 120000 });
  } catch { /* reported below */ }
  const status = await p.locator('.status').innerText().catch(() => '(none)');
  await p.getByRole('button', { name: 'Play', exact: true }).click().catch(() => undefined);
  await p.waitForTimeout(9000);
  const t = await p.locator('.readout .mono.muted').innerText().catch(() => '');
  const syl = await p.locator('.stage .syl.is-now').allInnerTexts().catch(() => []);
  const pass = status.startsWith('Ready') && /^0:0[7-9]/.test(t) && syl.length === 1;
  ok &&= pass;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${path === '/' ? 'artifact page, no CSP     ' : 'artifact page, strict CSP '} | ${status} | ${t} | singing "${syl[0] ?? ''}" ${errs.length ? '| errors: ' + errs.join('; ') : ''}`);
  await p.close();
}
await browser.close();
srv.close();
process.exit(ok ? 0 : 1);
