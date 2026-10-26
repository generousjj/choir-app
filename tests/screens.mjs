// Screenshots for visual review: phone size, light + dark, sheet music on.
//   node tests/screens.mjs [url] [outdir]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'out';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  await p.goto(url);
  await p.waitForFunction(() => document.querySelector('.status')?.textContent?.startsWith('Ready'), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Play', exact: true }).click();
  await p.waitForTimeout(scheme === 'light' ? 13000 : 9500);
  await p.getByRole('button', { name: 'Pause', exact: true }).click();
  if (scheme === 'dark') {
    await p.check('#sheet');
    await p.waitForSelector('.sheet-host svg', { timeout: 60000 });
    await p.waitForTimeout(1500);
    await p.locator('.sheet').screenshot({ path: `${out}/sheet-${scheme}.png` });
  }
  await p.screenshot({ path: `${out}/full-${scheme}.png`, fullPage: true });
  await p.close();
}
await b.close();
