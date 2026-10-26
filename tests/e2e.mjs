// End-to-end browser test of the practice app (headless Chromium).
//   node tests/e2e.mjs [url] [outdir]
// Exercises: load → synthesis → play → lyric highlight → pause → tempo
// change → loop → jump to measure, and saves the exact WAV the browser
// plays (out/browser-mix.wav) for the audio checks (pitch + ASR).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'out';
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();

const status = () => page.locator('.status').innerText();
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.startsWith('Ready'), null, { timeout: 90000 });
check('app loads and synthesizes', true, await status());
check('Bass part selected by default', (await page.locator('.chip.on').innerText()).includes('Bass'));

const getTime = () => page.evaluate(() => {
  const txt = document.querySelector('.readout .mono.muted')?.textContent ?? '';
  return txt;
});

await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(9000);
const t1 = await getTime();
const now = await page.locator('.stage .syl.is-now').allInnerTexts();
const measure = await page.locator('.readout b.mono').first().innerText();
check('playback advances', /^0:0[7-9]|^0:1/.test(t1), t1);
check('a syllable is highlighted while singing', now.length === 1, `highlighted "${now[0] ?? ''}", measure ${measure}`);
await page.screenshot({ path: `${out}/playing.png` });

await page.getByRole('button', { name: 'Pause', exact: true }).click();
const tp = await getTime();
await page.waitForTimeout(1500);
check('pause stops the clock', (await getTime()) === tp, tp);

// tempo 50%: re-synthesized, musical position kept
const mBefore = await page.locator('.readout b.mono').first().innerText();
await page.getByRole('button', { name: '50%' }).click();
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.startsWith('Ready'), null, { timeout: 60000 });
await page.waitForTimeout(800);
const total50 = (await getTime()).split('/')[1].trim();
const mAfter = await page.locator('.readout b.mono').first().innerText();
check('tempo 50% doubles the length', total50.startsWith('7:') || total50.startsWith('8:'), `total ${total50}`);
check('tempo change keeps the musical position', Math.abs(+mBefore - +mAfter) <= 1, `m.${mBefore} → m.${mAfter}`);

// loop m.12–14 and play: time must wrap back
await page.getByRole('button', { name: '100%' }).click();
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.startsWith('Ready'), null, { timeout: 60000 });
await page.fill('#loop-from', '12');
await page.fill('#loop-to', '13');
await page.getByRole('button', { name: 'Loop', exact: true }).click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Play', exact: true }).click();
const seen = new Set();
for (let i = 0; i < 24; i++) { seen.add(await page.locator('.readout b.mono').first().innerText()); await page.waitForTimeout(500); }
check('loop stays inside measures 12–13 (with lead-in)', [...seen].every((m) => ['11', '12', '13'].includes(m)) && seen.has('12') && seen.has('13'), [...seen].join(','));
await page.getByRole('button', { name: 'Pause', exact: true }).click();
await page.getByRole('button', { name: 'Looping' }).click();

// jump to measure 33
await page.fill('#jump', '33');
await page.getByRole('button', { name: 'Go', exact: true }).click();
await page.waitForTimeout(600);
const mj = await page.locator('.readout b.mono').first().innerText();
check('jump to measure 33', ['32', '33'].includes(mj), `now m.${mj}`);
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(2500);
const lyr = (await page.locator('.stage .phrase.big').innerText()).replace(/\s+/g, ' ');
check('lyrics at m.33 are "The kingdom of this world…"', /king/i.test(lyr), lyr);
await page.getByRole('button', { name: 'Pause', exact: true }).click();

// export the exact audio the page plays (whole piece, 100%)
const b64 = await page.evaluate(async () => {
  const src = window.__cppPlayer?.audio?.src; // the Player's <audio> element (not in the DOM)
  if (!src) return null;
  const buf = new Uint8Array(await (await fetch(src)).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
if (b64) { writeFileSync(`${out}/browser-mix.wav`, Buffer.from(b64, 'base64')); check('captured browser audio', true, `${Math.round(b64.length * 0.75 / 1024)} KB`); }
else check('captured browser audio', false, 'no player handle');

// import a MusicXML file (closed score: S and A on one staff, repeats, 2 verses)
await page.setInputFiles('#import', 'tests/fixtures/closed-score-test.musicxml');
await page.waitForFunction(() => document.querySelector('.note')?.textContent?.startsWith('Imported'), null, { timeout: 30000 });
check('MusicXML import', true, await page.locator('.note').innerText());
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.startsWith('Ready'), null, { timeout: 60000 });
const chips = await page.locator('.chip b').allInnerTexts();
check('imported closed score: S, A, T detected', ['S', 'A', 'T'].every((r) => chips.includes(r)), chips.join(' '));
check('review panel opens after import', await page.locator('.review').isVisible());
await page.locator('.chip', { hasText: 'Alto' }).click();
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('Women'), null, { timeout: 60000 });
await page.getByRole('tab', { name: 'Lyrics' }).click();
const altoText = (await page.locator('.lyric-list').innerText()).replace(/\s+/g, ' ');
check('alto line (shared staff) sung with its own words through the repeat', /Come.*now.*Come.*end.*Amen/.test(altoText), altoText.slice(0, 120));
// edit a pronunciation and apply
await page.getByRole('tab', { name: /Check/ }).click();
await page.uncheck('#rv-flag');
await page.locator('input[aria-label^="Pronunciation of"]').first().fill('K AH1 M');
await page.getByRole('button', { name: 'Apply corrections' }).click();
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.startsWith('Ready'), null, { timeout: 60000 });
check('pronunciation correction re-renders', (await page.locator('.badge.override').count()) > 0);
await page.selectOption('#song', 'hallelujah');

const errs = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
writeFileSync(`${out}/e2e-results.json`, JSON.stringify({ results, logs }, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
