// Quick visual/runtime smoke run: node tests/smoke.mjs <outdir> [url]
const { chromium } = require('playwright');
const out = process.argv[2], url = process.argv[3] || 'http://localhost:8765/index.html';
(async()=>{
const b = await chromium.launch();
const errs = [];
async function run(name, vp, fn) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(name + ': ' + m.text()); });
  p.on('pageerror', (e) => errs.push(name + ' PAGEERROR: ' + e.message));
  await p.goto(url);
  await p.waitForFunction(() => window.JE && JE.app && JE.app.S.ready, null, { timeout: 60000 });
  await fn(p);
  await ctx.close();
}
await run('desk', { width: 1366, height: 820 }, async (p) => {
  console.log('paginate ms', await p.evaluate(() => JE.app.S.paginateMs), 'pages', await p.evaluate(() => JE.app.S.textTotal), 'N', await p.evaluate(() => JE.app.S.m.N));
  await p.screenshot({ path: out + '/01-cover.png' });
  await p.click('#openBtn'); await p.waitForTimeout(700); await p.screenshot({ path: out + '/02-opening.png' });
  await p.waitForTimeout(1500); await p.screenshot({ path: out + '/03-title.png' });
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(450); await p.screenshot({ path: out + '/04-turning.png' });
  await p.waitForTimeout(800);
  await p.evaluate(() => JE.app.goToSection(2)); await p.waitForTimeout(1800); await p.screenshot({ path: out + '/05-ch1.png' });
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1200); await p.screenshot({ path: out + '/06-ch1b.png' });
});
await run('phone', { width: 390, height: 844 }, async (p) => {
  console.log('phone paginate ms', await p.evaluate(() => JE.app.S.paginateMs), 'pages', await p.evaluate(() => JE.app.S.textTotal));
  await p.screenshot({ path: out + '/11-m-cover.png' });
  await p.click('#openBtn'); await p.waitForTimeout(2200);
  await p.evaluate(() => JE.app.goToSection(2)); await p.waitForTimeout(1500); await p.screenshot({ path: out + '/12-m-ch1.png' });
});
console.log('errors:', errs);
await b.close();
})();
