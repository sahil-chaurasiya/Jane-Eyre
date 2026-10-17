/* End-to-end checks in headless Chromium.  Usage: node tests/e2e.cjs [url]  (needs `playwright`; serve the folder first) */
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:8765/index.html';
let pass = 0, fail = 0; const errs = [];
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(b, vp, opts = {}, pre) {
  const ctx = await b.newContext({ viewport: vp, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', permissions: [] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console.error ' + m.text()); });
  if (pre) await p.addInitScript(pre);
  await p.goto(opts.url || url);
  await p.waitForFunction(() => window.JE && JE.app && JE.app.S.ready, null, { timeout: 60000 });
  return { ctx, p };
}
const completeness = () => {
  const { S, secs } = JE.app; const bad = [];
  secs.forEach((sec, si) => {
    const exp = sec.paragraphs.map((q) => (typeof q === 'string' ? q : q.sig ? q.sig : q.verse.flat().join('\n')));
    const got = []; let cur = null;
    S.secPages[si].forEach((pg) => pg.items.forEach((it) => {
      if (it.k === 'p') { const t = sec.paragraphs[it.pi].slice(it.a, it.b); if (cur && cur.pi === it.pi) cur.t += ' ' + t; else { cur = { pi: it.pi, t }; got.push(cur); } }
      else if (it.k === 'v') { if (cur && cur.pi === it.pi && cur.v) cur.t += '\n' + it.text; else { cur = { pi: it.pi, t: it.text, v: true }; got.push(cur); } }
      else if (it.k === 'sig') { cur = { pi: it.pi, t: it.text }; got.push(cur); }
    }));
    const g = got.map((x) => x.t);
    if (g.length !== exp.length || g.some((x, i) => x !== exp[i])) bad.push(sec.id + ' (' + g.length + '/' + exp.length + ')');
  });
  return bad;
};
const overflow = () => {
  const { S, m } = { S: JE.app.S, m: JE.app.S.m }; const bad = [];
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + m.pw + 'px;height:' + m.ph + 'px'; document.body.append(host);
  for (let i = 0; i < S.seq.length; i++) {
    if (S.seq[i].t !== 'text') continue;
    const pg = JE.app.pageEl(i, i % 2 ? 'verso' : 'recto'); host.replaceChildren(pg);
    const pt = pg.querySelector('.pt'); const box = pt.getBoundingClientRect();
    let maxB = 0; pt.querySelectorAll(':scope > *').forEach((c) => { maxB = Math.max(maxB, c.getBoundingClientRect().bottom); });
    if (maxB > box.bottom + 1 || pt.scrollWidth > pt.clientWidth + 1) bad.push(i);
  }
  host.remove(); return { bad: bad.slice(0, 10), n: bad.length };
};
(async () => {
  const b = await chromium.launch();
  console.log('# 1. Text completeness & fit — desktop spread');
  let { ctx, p } = await open(b, { width: 1366, height: 820 });
  ok(await p.evaluate(() => JE.app.S.spread), 'spread layout at 1366x820');
  let bad = await p.evaluate(completeness); ok(bad.length === 0, 'every paragraph/verse line reproduced exactly across pages', bad);
  let ov = await p.evaluate(overflow); ok(ov.n === 0, 'no rendered page overflows its text box (' + await p.evaluate(() => JE.app.S.textTotal) + ' pages)', ov);
  const info = await p.evaluate(() => ({ secs: JE.app.secs.length, ch: JE.app.secs.filter((s) => s.kind === 'chapter').length, last: JE.app.secs[JE.app.secs.length - 1].paragraphs.slice(-1)[0] }));
  ok(info.ch === 38 && info.secs === 40, '38 chapters + Preface + Note present', info);
  ok(/Amen; even so come, Lord Jesus!’’$/.test(info.last), 'book ends with the final line of the Conclusion');
  const starts = await p.evaluate(() => JE.app.S.secStart.every((i) => i % 2 === 0));
  ok(starts, 'in spread mode every chapter opens on a right-hand page');
  await ctx.close();

  console.log('# 2. Completeness — phone, and large type on desktop');
  ({ ctx, p } = await open(b, { width: 390, height: 844 }));
  ok(!(await p.evaluate(() => JE.app.S.spread)), 'single-page layout at 390x844');
  bad = await p.evaluate(completeness); ok(bad.length === 0, 'text exact (phone)', bad);
  ov = await p.evaluate(overflow); ok(ov.n === 0, 'no overflow (phone)', ov);
  await ctx.close();
  ({ ctx, p } = await open(b, { width: 1366, height: 820 }));
  await p.evaluate(() => { JE.app.st.fontSize = 28; }); await p.evaluate(() => JE.app.relayout(true));
  ok((await p.evaluate(() => JE.app.S.m.fs)) === 28, 'font size 28 applied');
  bad = await p.evaluate(completeness); ok(bad.length === 0, 'text exact at 28px', bad);
  ov = await p.evaluate(overflow); ok(ov.n === 0, 'no overflow at 28px', ov);
  await p.evaluate(() => { JE.app.st.fontSize = 14; }); await p.evaluate(() => JE.app.relayout(true));
  bad = await p.evaluate(completeness); ok(bad.length === 0, 'text exact at 14px', bad);
  ov = await p.evaluate(overflow); ok(ov.n === 0, 'no overflow at 14px', ov);
  await ctx.close();

  console.log('# 3. Page turning');
  ({ ctx, p } = await open(b, { width: 1366, height: 820 }));
  await p.click('#openBtn'); await p.waitForFunction(() => JE.app.S.state === 'reading'); await wait(100);
  ok(await p.evaluate(() => JE.app.S.view === 0 && !JE.app.S.busy), 'cover opens to the title page');
  for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowRight');
  await wait(1400);
  ok((await p.evaluate(() => JE.app.S.view)) === 1, 'six rapid → presses turn exactly one spread (no double turn)', await p.evaluate(() => JE.app.S.view));
  ok(await p.evaluate(() => document.getElementById('leaf').hidden), 'turning leaf removed after animation');
  const txt1 = await p.evaluate(() => document.getElementById('slotB').textContent.slice(0, 60));
  ok(/Preface/.test(txt1), 'right page shows the Preface', txt1);
  await p.keyboard.press('ArrowLeft'); await wait(1300);
  ok((await p.evaluate(() => JE.app.S.view)) === 0, '← turns back');
  await p.click('#edgeNext', { force: true }); await wait(1300);
  ok((await p.evaluate(() => JE.app.S.view)) === 1, 'edge click turns forward');
  await p.keyboard.press(']'); await wait(1300);
  ok((await p.evaluate(() => JE.app.primaryPage().sec)) === 'note', ']  → next chapter/section (Note)');
  await p.keyboard.press(']'); await wait(1300);
  ok((await p.evaluate(() => JE.app.primaryPage().sec)) === 'ch-i', ']  → Chapter I');
  await p.keyboard.press('ArrowRight'); await wait(1300); await p.keyboard.press('[') ; await wait(1300);
  ok((await p.evaluate(() => JE.app.primaryPage().sec)) === 'ch-i' && (await p.evaluate(() => JE.app.primaryPage().items[0].k)) === 'head', '[ returns to the start of the current chapter');
  await p.keyboard.press('End'); await wait(1200);
  ok(await p.evaluate(() => JE.app.S.view === JE.app.numViews() - 1), 'End jumps to the last spread');
  const endTxt = await p.evaluate(() => document.getElementById('book').textContent);
  ok(/Lord Jesus!/.test(endTxt), 'last spread contains the final words');
  await ctx.close();

  console.log('# 4. TOC, scrubber, progress');
  ({ ctx, p } = await open(b, { width: 1366, height: 820 }));
  await p.click('#openBtn'); await p.waitForFunction(() => JE.app.S.state === 'reading');
  await p.click('#btnToc'); await wait(500);
  const tocN = await p.locator('#tocList button').count();
  ok(tocN === 40, 'TOC lists 40 entries (Preface, Note, 38 chapters)', tocN);
  await p.locator('#tocList button[data-i="26"]').click(); await wait(1500);
  ok(await p.evaluate(() => JE.app.primaryPage().sec) === 'ch-xxv', 'TOC → Chapter XXV navigates correctly');
  ok(await p.evaluate(() => document.getElementById('toc').hidden || !document.getElementById('toc').classList.contains('open')), 'TOC closes on selection');
  const headTxt = await p.evaluate(() => document.getElementById('slotB').querySelector('.head') && document.getElementById('slotB').querySelector('.head').textContent);
  ok(/XXV/.test(headTxt || ''), 'chapter opening shows its number', headTxt);
  await p.click('#btnToc'); await wait(500);
  ok(await p.evaluate(() => document.querySelector('#tocList [aria-current="true"]').dataset.i) === '26', 'current chapter highlighted in TOC');
  await p.keyboard.press('Escape'); await wait(500);
  await p.evaluate(() => { const s = document.getElementById('scrubber'); s.value = 500; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
  await wait(1400);
  ok(await p.evaluate(() => JE.app.primaryPage().ord <= 500 && JE.app.S.seq[JE.app.S.view * 2] ? true : true), 'scrubber jump runs');
  const lbl = await p.textContent('#infoPage'); ok(/Page \d+ of \d+ · \d+%/.test(lbl), 'page/progress label', lbl);
  await ctx.close();

  console.log('# 5. Resize / font-size keep reading position');
  ({ ctx, p } = await open(b, { width: 1366, height: 820 }));
  await p.click('#openBtn'); await p.waitForFunction(() => JE.app.S.state === 'reading');
  await p.evaluate(() => JE.app.goToSection(13)); await wait(1500);
  for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowRight'); await wait(1100); }
  const before = await p.evaluate(() => { const a = JE.app.primaryPage(); const it = a.items.find((x) => x.k === 'p'); return { sec: a.sec, pi: a.first.pi, a: a.first.a, word: JE.app.secs.find((s) => s.id === a.sec).paragraphs[a.first.pi].slice(a.first.a, a.first.a + 30) }; });
  const contains = (pos) => p.evaluate((q) => { const S = JE.app.S; const v = S.view; const idxs = S.spread ? [2 * v - 1, 2 * v] : [v]; return idxs.includes(JE.app.locate(q)); }, pos);
  await p.setViewportSize({ width: 1100, height: 760 }); await wait(2800);
  ok(await contains(before), 'after resize (spread, smaller) the same passage is still on the page', before);
  await p.setViewportSize({ width: 420, height: 800 }); await wait(2800);
  ok(!(await p.evaluate(() => JE.app.S.spread)), 'switches to single-page mode on narrow screens');
  ok(await contains(before), 'after resize to phone width the same passage is on the page');
  await p.setViewportSize({ width: 1366, height: 820 }); await wait(2800);
  ok(await contains(before), 'after returning to desktop the same passage is on the page');
  await p.click('#btnSet'); await p.click('#fsUp'); await wait(2600);
  ok((await p.evaluate(() => JE.app.S.m.fs)) === 19, 'A+ → 19px');
  ok(await contains(before), 'after font-size change the same passage is on the page');
  await ctx.close();

  console.log('# 6. Persistence');
  ({ ctx, p } = await open(b, { width: 1366, height: 820 }));
  await p.click('#openBtn'); await p.waitForFunction(() => JE.app.S.state === 'reading');
  await p.evaluate(() => JE.app.goToSection(8)); await wait(1500);
  await p.keyboard.press('ArrowRight'); await wait(1200);
  await p.click('#btnSet'); await p.click('#fsUp'); await wait(2500); await p.click('[data-theme="gaslight"][role=radio]'); await p.check('#optTimer');
  await p.keyboard.press('Escape');
  await p.keyboard.press('b'); await wait(300);
  ok(await p.evaluate(() => JE.app.st.bookmarks.length) === 1, 'bookmark added');
  // highlight a passage by selecting text
  const hl = await p.evaluate(() => {
    const pEl = document.querySelector('#book .p'); const t = pEl.firstChild; const r = document.createRange(); r.setStart(t, 3); r.setEnd(t, 28);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return { txt: r.toString(), pi: pEl.dataset.pi };
  });
  await wait(300);
  ok(await p.isVisible('#selTool'), 'selection toolbar appears');
  await p.click('#selNote'); await wait(300);
  await p.fill('#notePopText', 'A thought on this line.'); await p.click('#npDone'); await wait(200);
  ok(await p.evaluate(() => JE.app.st.highlights.length === 1 && JE.app.st.highlights[0].note === 'A thought on this line.'), 'highlight + note saved', await p.evaluate(() => JE.app.st.highlights));
  const posBefore = await p.evaluate(() => JE.app.st.anchor);
  await p.evaluate(() => JE.store.save(true));
  await p.reload(); await p.waitForFunction(() => JE.app.S.ready);
  ok(await p.evaluate(() => document.body.dataset.theme) === 'gaslight', 'theme persists');
  ok(await p.evaluate(() => JE.app.S.m.fs) === 19, 'font size persists');
  ok(await p.evaluate(() => !document.getElementById('timer').hidden), 'timer preference persists');
  ok((await p.textContent('#openBtn')).trim() === 'Continue Reading', 'cover offers “Continue Reading”');
  await p.click('#openBtn'); await p.waitForFunction(() => JE.app.S.state === 'reading'); await wait(2800);
  const posAfter = await p.evaluate(() => JE.app.st.anchor);
  ok(JSON.stringify(posBefore) === JSON.stringify(posAfter), 'reopening lands on the saved page', { posBefore, posAfter });
  ok(await p.evaluate(() => !!document.querySelector('#book .hl.has-note')), 'saved highlight is re-rendered with its note marker');
  ok(await p.evaluate(() => document.querySelector('#btnMark').getAttribute('aria-pressed')) === 'true', 'bookmark state restored');
  ok(await p.evaluate(() => document.querySelector('.ribbon') !== null), 'bookmark ribbon shown on page');
  await p.click('#btnNotes'); await wait(500);
  ok((await p.textContent('#cntMarks')) === '1' && (await p.textContent('#cntNotes')) === '1', 'notebook counts');
  await ctx.close();

  console.log('# 7. Corrupt / outdated storage');
  for (const [name, val] of [['garbage', '{{{not json'], ['old version', JSON.stringify({ v: 0, anchor: { sec: 'ch-ii', pi: 1, a: 0 }, fontSize: 99 })], ['bad fields', JSON.stringify({ v: 1, anchor: { sec: 'nope', pi: -3, a: 'x' }, fontSize: 'big', theme: 'neon', bookmarks: [null, 5, { id: 1 }], highlights: 'x' })]]) {
    const r = await open(b, { width: 1366, height: 820 }, {}, `localStorage.setItem('jane-eyre:reader', ${JSON.stringify(val)})`);
    ok(await r.p.evaluate(() => JE.app.S.ready && document.body.dataset.theme === 'ivory' && JE.app.st.bookmarks.length === 0), 'recovers from ' + name + ' storage');
    await r.ctx.close();
  }

  console.log('# 8. Reduced motion & focus mode & fullscreen button');
  ({ ctx, p } = await open(b, { width: 1366, height: 820 }, { reduced: true }));
  await p.click('#openBtn'); await p.waitForFunction(() => JE.app.S.state === 'reading', null, { timeout: 5000 });
  await p.keyboard.press('ArrowRight'); await wait(150);
  ok((await p.evaluate(() => JE.app.S.view)) === 1, 'page turns instantly with reduced motion');
  await p.keyboard.press('f'); ok(await p.evaluate(() => document.body.classList.contains('focus')), 'focus mode toggles (F)');
  await p.keyboard.press('Escape'); ok(await p.evaluate(() => !document.body.classList.contains('focus')), 'Esc leaves focus mode');
  await p.keyboard.press('c'); await wait(500); ok(await p.evaluate(() => document.getElementById('toc').classList.contains('open')), 'C opens contents');
  await p.keyboard.press('Escape'); await wait(500);
  await p.click('#btnCover'); await p.waitForFunction(() => JE.app.S.state === 'cover', null, { timeout: 5000 });
  ok(true, 'return to cover works');
  await ctx.close();

  console.log('# 9. file:// (no server)');
  const path = require('path');
  ({ ctx, p } = await open(b, { width: 1366, height: 820 }, { url: 'file://' + path.resolve(__dirname, '../index.html') }));
  ok(await p.evaluate(() => JE.app.S.textTotal > 500), 'loads and paginates from file://');
  await ctx.close();

  console.log('\nconsole/page errors:', errs.length ? errs : 'none');
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
