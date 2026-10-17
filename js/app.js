/* Jane Eyre — immersive reader. Orchestrates layout, pagination, page turning, panels and persistence. */
(function (JE) {
  'use strict';
  const book = window.JANE_EYRE_BOOK;
  const secs = book.sections;
  const $ = (id) => document.getElementById(id);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const secById = new Map(secs.map((s, i) => [s.id, i]));
  const labelOf = (s) => (s.kind === 'chapter' ? 'Chapter ' + s.numeral : s.title);
  const FS = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28];
  const TOP = 52, BOT = 64;
  const el = {};
  const S = {
    state: 'cover', busy: false, ready: false, spread: true, m: null, key: '', token: 0,
    secPages: [], seq: [], secStart: [], ordIdx: [], textTotal: 0, view: 0, resumeView: 0, anim: null, pose: null,
    pending: null, noteFor: null, lastInput: Date.now(), drawer: null,
    keep: null, flash: null, flashT: 0, pauseOpen: false, pauseSeen: new Set(), pauseFrom: -1, ribbonMoved: false
  };
  const store = JE.store;
  let st = store.state;

  /* ---------- helpers ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function toast(msg, ms) { const t = el.toast; t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 2400); }
  function announce(msg) { el.live.textContent = ''; setTimeout(() => { el.live.textContent = msg; }, 30); }
  const viewIdx = (idx) => (S.spread ? Math.ceil(idx / 2) : idx);
  const leftIdx = (v) => 2 * v - 1;
  const rightIdx = (v) => 2 * v;
  const numViews = () => viewIdx(S.seq.length - 1) + 1;

  /* ---------- layout metrics ---------- */
  function computeMetrics() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const availH = Math.max(300, vh - TOP - BOT);
    const spread = vw >= 860 && vw / vh >= 1.0;
    let pw, ph;
    const phone = !spread && vw <= 560;
    if (spread) {
      pw = Math.min((vw - 48) / 2, availH * 0.74);
      ph = Math.min(availH, pw / 0.62);
      pw = Math.min(pw, ph * 0.74);
    } else if (phone) { pw = vw; ph = availH; }
    else { pw = Math.min(vw - 24, availH * 0.8); ph = Math.min(availH, pw / 0.6); }
    pw = Math.floor(pw); ph = Math.floor(ph);
    const fs = st.fontSize || (pw >= 440 ? 18 : 17);
    const lh = Math.round(fs * 1.62);
    const pt = Math.max(34, Math.round(ph * 0.075));
    const pin = phone ? 24 : Math.round(pw * 0.1);
    const pout = phone ? 20 : Math.round(pw * 0.082);
    const tw = pw - pin - pout;
    const N = Math.max(6, Math.floor((ph - pt - Math.max(40, ph * 0.085)) / lh));
    const pb = ph - pt - N * lh;
    const headLines = clamp(Math.round(N * 0.28), 6, 8);
    return { vw, vh, spread, pw, ph, fs, lh, pt, pb, pin, pout, tw, N, headLines };
  }
  function applyMetrics(m) {
    const r = document.documentElement.style;
    r.setProperty('--pw', m.pw + 'px'); r.setProperty('--ph', m.ph + 'px');
    r.setProperty('--pt', m.pt + 'px'); r.setProperty('--pb', m.pb + 'px');
    r.setProperty('--pin', m.pin + 'px'); r.setProperty('--pout', m.pout + 'px'); r.setProperty('--tw', m.tw + 'px');
    r.setProperty('--fs', m.fs + 'px'); r.setProperty('--lh', m.lh + 'px'); r.setProperty('--N', m.N);
    r.setProperty('--head', Math.min(m.headLines, m.N - 6));
    el.book.dataset.mode = m.spread ? 'spread' : 'single';
    S.spread = m.spread; S.m = m;
    el.fsOut.textContent = m.fs;
    if (S.state === 'cover') setPose(coverPose());
  }
  const keyOf = (m) => [m.tw, m.N, m.lh, m.fs, m.headLines, m.spread].join('|');

  /* ---------- book pose (centres the closed book / the open spread) ---------- */
  const coverPose = () => ({ x: S.spread ? -S.m.pw / 2 : 0, y: -34, s: 0.9 });
  const readPose = () => ({ x: 0, y: 0, s: 1 });
  const poseCss = (p) => 'translate(calc(-50% + ' + p.x + 'px), calc(-50% + ' + p.y + 'px)) scale(' + p.s + ')';
  function setPose(p) { S.pose = p; el.wrap.style.transform = poseCss(p); }

  /* ---------- loading plate (shown only while pages are genuinely being set) ---------- */
  function showVeil() { el.veilText.textContent = 'Setting the type…'; el.veilRetry.hidden = true; el.veil.hidden = false; }
  function loadFailed(err) {
    try { console.error(err); } catch (e) { /* noop */ }
    if (S.ready) { el.veil.hidden = true; toast('The pages could not be re-set. Reloading the page may help.', 4200); return; }
    el.veilText.textContent = 'The pages could not be set.'; el.veilRetry.hidden = false; el.veil.hidden = false;
    el.coverNote.textContent = 'The text could not be set. Please reload.';
  }

  /* ---------- pagination ---------- */
  async function repaginate() {
    const token = ++S.token;
    const m = S.m;
    const anchor = S.pendingAnchor || st.anchor;
    const veilTimer = setTimeout(() => { if (token === S.token) showVeil(); }, 350);
    const t0 = performance.now();
    const out = [];
    try {
      const pg = new JE.Paginator(el.measure, m);
      for (let i = 0; i < secs.length; i++) {
        out.push(pg.section(secs[i], i));
        if (i % 3 === 2) { await tick(); if (token !== S.token) { clearTimeout(veilTimer); return; } }
      }
    } catch (err) { clearTimeout(veilTimer); loadFailed(err); return; }
    el.measure.textContent = '';
    clearTimeout(veilTimer); el.veil.hidden = true;
    S.secPages = out; S.key = keyOf(m);
    buildSeq();
    S.ready = true; S.pendingAnchor = null;
    S.paginateMs = Math.round(performance.now() - t0);
    S.view = anchor ? viewIdx(locate(anchor)) : (S.state === 'reading' ? S.view : 0);
    S.view = clamp(S.view, 0, numViews() - 1);
    S.resumeView = st.anchor ? viewIdx(locate(st.anchor)) : 0;
    setSlots(S.view);
    buildToc();
    afterChange(true, true);
  }
  function buildSeq() {
    const seq = [{ t: 'title' }];
    if (S.spread) seq.push({ t: 'imprint' });
    S.secStart = [];
    secs.forEach((s, i) => {
      if (S.spread && seq.length % 2 === 1) seq.push({ t: 'blank' });
      S.secStart[i] = seq.length;
      S.secPages[i].forEach((p) => { p.t = 'text'; seq.push(p); });
    });
    S.ordIdx = []; let ord = 0;
    seq.forEach((p, i) => { p.idx = i; if (p.t === 'text') { p.ord = ++ord; S.ordIdx[ord] = i; } });
    S.seq = seq; S.textTotal = ord;
  }
  function locate(a) {
    const si = secById.get(a.sec);
    if (si == null || !S.secPages[si] || !S.secPages[si].length) return 0;
    const pgs = S.secPages[si]; let best = 0;
    for (let i = 0; i < pgs.length; i++) {
      const f = pgs[i].first;
      if (f.pi < a.pi || (f.pi === a.pi && f.a <= a.a)) best = i; else break;
    }
    return pgs[best].idx;
  }

  /* ---------- page construction ---------- */
  function itemNode(sec, it) {
    if (it.k === 'head') {
      const h = mk('div', 'head');
      if (sec.kind === 'chapter') {
        h.append(mk('span', 'h-label', 'Chapter'), mk('span', 'h-num', sec.numeral));
        if (sec.title) h.append(mk('span', 'h-sub', sec.title.toUpperCase()));
      } else h.append(mk('span', 'h-num h-title' + (sec.title.length > 12 ? ' long' : ''), sec.title));
      h.append(mk('span', 'orn'));
      return h;
    }
    if (it.k === 'p') {
      const text = sec.paragraphs[it.pi];
      const p = mk('p', 'p ' + it.cls);
      p.dataset.sec = sec.id; p.dataset.pi = it.pi; p.dataset.a = it.a; p.dataset.b = it.b;
      fillText(p, sec.id, it.pi, text, it.a, it.b);
      return p;
    }
    if (it.k === 'v') return mk('p', 'vl' + (it.gap ? ' sg' : ''), it.text);
    return mk('p', 'sig' + (it.gap ? ' sg' : ''), it.text);
  }
  function fillText(p, secId, pi, text, a, b) {
    const hs = st.highlights.filter((h) => h.sec === secId && h.pi === pi && h.b > a && h.a < b).sort((x, y) => x.a - y.a);
    const F = S.flash; let fl = null;
    if (F && F.sec === secId && pi >= F.pi && pi <= F.pi2) {
      const s0 = Math.max(pi === F.pi ? F.a : 0, a), e0 = Math.min(pi === F.pi2 ? F.b : text.length, b);
      if (e0 > s0) fl = [s0, e0];
    }
    if (fl) {            // a passage is being pointed out: split at every highlight/flash boundary
      const cuts = new Set([a, b, fl[0], fl[1]]); hs.forEach((h) => { cuts.add(Math.max(h.a, a)); cuts.add(Math.min(h.b, b)); });
      const pts = [...cuts].sort((x, y) => x - y);
      for (let i = 0; i < pts.length - 1; i++) {
        const s1 = pts[i], e1 = pts[i + 1]; if (e1 <= s1) continue;
        const h = hs.find((x) => x.a <= s1 && x.b >= e1), inF = s1 >= fl[0] && e1 <= fl[1];
        if (!h && !inF) { p.append(document.createTextNode(text.slice(s1, e1))); continue; }
        const sp = mk('span', (h ? 'hl' + (h.note ? ' has-note' : '') : '') + (inF ? (h ? ' ' : '') + 'flash' : ''), text.slice(s1, e1));
        if (h) { sp.dataset.id = h.id; sp.tabIndex = 0; sp.setAttribute('role', 'button'); sp.setAttribute('aria-label', 'Highlight' + (h.note ? ' with note' : '') + ': open'); }
        p.append(sp);
      }
      return;
    }
    let pos = a;
    for (const h of hs) {
      const s = Math.max(h.a, a), e = Math.min(h.b, b);
      if (s < pos) continue;
      if (s > pos) p.append(document.createTextNode(text.slice(pos, s)));
      const sp = mk('span', 'hl' + (h.note ? ' has-note' : ''), text.slice(s, e));
      sp.dataset.id = h.id; sp.tabIndex = 0; sp.setAttribute('role', 'button'); sp.setAttribute('aria-label', 'Highlight' + (h.note ? ' with note' : '') + ': open');
      p.append(sp); pos = e;
    }
    if (pos < b) p.append(document.createTextNode(text.slice(pos, b)));
  }
  function pageEl(idx, side) {
    if (!S.spread) side = 'recto';
    const e = mk('div', 'page ' + side);
    if (idx < 0) { e.className += ' endp'; e.append(mk('div', 'endpaper')); return e; }
    const p = S.seq[idx];
    if (!p) { e.className += ' blank'; return e; }
    if (p.t === 'title') {
      e.className += ' title';
      e.append(mk('div', 'title-frame'), mk('div', 't-over', 'A Classic Novel'), mk('h2', 't-title', 'Jane Eyre'), mk('span', 'orn'), mk('div', 't-by', 'by'), mk('div', 't-name', 'CHARLOTTE BRONTË'));
    } else if (p.t === 'imprint') {
      e.className += ' imprint';
      e.append(mk('p', '', 'This reading edition sets the complete text of Charlotte Brontë’s Jane Eyre as supplied in the Planet eBook edition: the Preface, the Note to the Third Edition, and thirty-eight chapters, in their original order.'),
        mk('span', 'orn'),
        mk('p', '', 'Italics are not preserved in the source text and have not been restored. Set in EB Garamond and Cormorant Garamond.'));
    } else if (p.t === 'blank') {
      e.className += ' blank'; e.append(mk('span', 'orn'));
    } else {
      const sec = secs[p.sIdx];
      const pt = mk('div', 'pt'); pt.setAttribute('role', 'document');
      p.items.forEach((it) => pt.append(itemNode(sec, it)));
      e.append(pt);
      if (p.items[0].k !== 'head') e.append(mk('div', 'runhead', e.classList.contains('verso') ? 'Jane Eyre' : labelOf(sec)));
      e.append(mk('div', 'folio', String(p.ord)));
      if (isMarked(p)) {
        const r = mk('button', 'ribbon'); r.setAttribute('aria-label', 'Bookmarked — remove bookmark'); r.title = 'Remove bookmark';
        r.addEventListener('click', (ev) => { ev.stopPropagation(); toggleMark(idx); });
        e.append(r);
      }
    }
    return e;
  }
  function setSlots(v) {
    el.slotA.replaceChildren(); el.slotB.replaceChildren();
    if (S.spread) { el.slotA.append(pageEl(leftIdx(v), 'verso')); el.slotB.append(pageEl(rightIdx(v), 'recto')); }
    else el.slotB.append(pageEl(v, 'recto'));
    el.slotA.style.visibility = S.state === 'cover' ? 'hidden' : '';
  }

  /* ---------- page turning ---------- */
  /* the rustle plays only for a genuine turn the reader asked for (never for restoring a saved place) */
  function pageSound(dir, far) { if (st.pageSound && S.state === 'reading' && JE.paper) JE.paper.play(dir, st.pageVol, far); }
  const paperBack = () => mk('div', 'page verso paper-back');
  const EASE = 'cubic-bezier(.45,0,.3,1)';
  function turnTo(t, opts) {
    opts = opts || {};
    if (S.busy || !S.ready || t === S.view || t < 0 || t >= numViews()) return Promise.resolve(false);
    if (JE.journal) JE.journal.hideKeep();
    if (!opts.silent) pageSound(t > S.view ? 1 : -1, Math.abs(t - S.view) > 1);
    if (reduce.matches || opts.instant) { S.view = t; setSlots(t); afterChange(); return Promise.resolve(true); }
    S.busy = true;
    const dir = t > S.view ? 1 : -1, far = Math.abs(t - S.view) > 1;
    const dur = far ? 760 : 980;
    const leaf = el.leaf; let front, back, from, to, cast;
    if (S.spread) {
      if (dir > 0) { front = pageEl(rightIdx(S.view), 'recto'); back = pageEl(leftIdx(t), 'verso'); el.slotB.replaceChildren(pageEl(rightIdx(t), 'recto')); leaf.className = 'leaf from-right'; from = 0; to = -180; cast = el.castB; }
      else { front = pageEl(leftIdx(S.view), 'verso'); back = pageEl(rightIdx(t), 'recto'); el.slotA.replaceChildren(pageEl(leftIdx(t), 'verso')); leaf.className = 'leaf from-left'; from = 0; to = 180; cast = el.castA; }
    } else if (dir > 0) { front = pageEl(S.view, 'recto'); back = paperBack(); el.slotB.replaceChildren(pageEl(t, 'recto')); leaf.className = 'leaf from-right'; from = 0; to = -180; cast = el.castB; }
    else { front = pageEl(t, 'recto'); back = paperBack(); leaf.className = 'leaf from-right'; from = -180; to = 0; cast = el.castB; }
    const fF = mk('div', 'fshade f'), fB = mk('div', 'fshade b');
    leaf.firstElementChild.replaceChildren(front, fF); leaf.children[1].replaceChildren(back, fB);
    leaf.hidden = false;
    const mid = (from + to) / 2;
    const kf = [{ transform: 'rotateY(' + from + 'deg)' }, { transform: 'rotateY(' + mid + 'deg)', offset: .5 }, { transform: 'rotateY(' + to + 'deg)' }];
    const o = { duration: dur, easing: EASE, fill: 'forwards' };
    const anims = [leaf.animate(kf, o)];
    const sh = (node, a, b2, c) => anims.push(node.animate([{ opacity: a }, { opacity: b2, offset: .5 }, { opacity: c }], o));
    if (dir > 0 || !S.spread) { sh(fF, 0, .5, .5); sh(fB, .5, .5, 0); } else { sh(fF, 0, .5, .5); sh(fB, .5, .5, 0); }
    if (S.spread || dir > 0) anims.push(cast.animate([{ opacity: 0 }, { opacity: .85, offset: .4 }, { opacity: 0 }], o));
    S.anim = anims;
    return anims[0].finished.then(() => true, () => false).then((ok) => {
      S.anim = null;
      S.view = t; setSlots(t);
      leaf.hidden = true; leaf.replaceChildren(...[mk('div', 'face front'), mk('div', 'face back'), mk('div', 'shade s-front')]);
      anims.forEach((a) => { try { a.cancel(); } catch (e) { /* already gone */ } });
      S.busy = false; afterChange(); return ok;
    });
  }
  function finishFlip() { if (S.anim) S.anim.forEach((a) => { try { a.finish(); } catch (e) { /* noop */ } }); }
  const next = () => {
    if (S.state !== 'reading') return;
    if (S.view >= numViews() - 1) { toast('The end of the book.'); return; }
    if (st.chapterPause && !S.busy && !S.pauseOpen && maybePause()) return;
    turnTo(S.view + 1);
  };
  /* ---------- optional pause at a chapter's end (only on an ordinary forward turn, once per boundary per visit) ---------- */
  function chapterEnding() {      // the chapter whose final page is on the spread being left (else -1)
    for (const q of visibleIdx().map((i) => S.seq[i])) {
      if (!q || q.t !== 'text' || q.sIdx >= secs.length - 1) continue;
      const pgs = S.secPages[q.sIdx];
      if (pgs[pgs.length - 1] === q) return q.sIdx;
    }
    return -1;
  }
  const nameOf = (s) => (s.kind === 'chapter' ? 'Chapter ' + s.numeral : s.title);
  function maybePause() {
    const si = chapterEnding();
    if (si < 0 || S.pauseSeen.has(si)) return false;
    S.pauseSeen.add(si); S.pauseFrom = si;
    const a = secs[si], b = secs[si + 1];
    $('pauseT').textContent = 'End of ' + (a.kind === 'chapter' ? nameOf(a) : 'the ' + a.title);
    $('pauseNext').textContent = nameOf(b) + (b.kind === 'chapter' && b.title ? ': ' + b.title : '');
    $('pauseGo').textContent = 'Continue to ' + nameOf(b);
    el.pause.hidden = false; S.pauseOpen = true; announce('End of ' + nameOf(a) + '. Continue to ' + nameOf(b) + ' when you are ready.');
    $('pauseGo').focus({ preventScroll: true });
    return true;
  }
  function hidePause(proceed) {
    if (!S.pauseOpen) return;
    el.pause.hidden = true; S.pauseOpen = false;
    if (proceed && S.state === 'reading' && !S.busy) turnTo(S.view + 1); else el.next.focus({ preventScroll: true });
  }
  const prev = () => { if (S.state !== 'reading') return; if (S.view <= 0) { toast('This is the first page.'); return; } turnTo(S.view - 1); };

  /* ---------- reading position ---------- */
  function primaryPage() {
    if (!S.seq.length) return null;
    const r = S.spread ? S.seq[rightIdx(S.view)] : null;
    const l = S.spread ? S.seq[leftIdx(S.view)] : S.seq[S.view];
    if (r && r.t === 'text' && r.items[0].k === 'head') return r;
    if (l && l.t === 'text') return l;
    if (r && r.t === 'text') return r;
    return null;
  }
  function currentAnchor() {
    const p = primaryPage();
    return p ? { sec: p.sec, pi: p.first.pi, a: p.first.a } : (st.anchor || null);
  }
  function visibleIdx() { return S.spread ? [leftIdx(S.view), rightIdx(S.view)] : [S.view]; }
  function afterChange(silent, keep) {
    const p = primaryPage();
    const stillShown = keep && st.anchor && visibleIdx().includes(locate(st.anchor));
    if (S.state === 'reading' && p && !stillShown) { st.anchor = { sec: p.sec, pi: p.first.pi, a: p.first.a }; st.started = true; S.ribbonMoved = true; store.save(); }
    updateUi(p, silent);
  }
  function updateUi(p, silent) {
    const tot = S.textTotal || 1;
    const sec = p ? secs[p.sIdx] : null;
    const ord = p ? p.ord : 0;
    const chapLabel = sec ? (sec.kind === 'chapter' ? 'Chapter ' + sec.numeral + (sec.title ? ' — ' + sec.title : '') : sec.title) : 'Title page';
    el.barChap.textContent = chapLabel;
    el.infoChap.textContent = chapLabel;
    const pct = Math.round((ord / tot) * 100);
    el.infoPage.textContent = ord ? 'Page ' + ord + ' of ' + tot + ' · ' + pct + '%' : 'Opening pages';
    el.scrub.max = tot; el.scrub.value = ord || 1;
    el.scrub.style.setProperty('--fill', ((ord || 0) / tot * 100) + '%');
    document.documentElement.style.setProperty('--prog', pct + '%');
    el.book.style.setProperty('--swl', (2 + (ord / tot) * 11).toFixed(1) + 'px');
    el.book.style.setProperty('--swr', (2 + (1 - ord / tot) * 11).toFixed(1) + 'px');
    el.prev.disabled = S.view <= 0; el.next.disabled = S.view >= numViews() - 1;
    const si = p ? p.sIdx : -1;
    el.prevCh.disabled = !p; el.nextCh.disabled = si >= secs.length - 1;
    document.querySelectorAll('#tocList button').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.i) === si)));
    refreshMarkBtn(); updateRibbon();
    if (!silent && S.state === 'reading') announce(chapLabel + (ord ? ', page ' + ord + ' of ' + tot : ''));
  }

  /* ---------- the place ribbon: mirrors the saved reading position (st.anchor), never keeps state of its own ---------- */
  function updateRibbon() {
    const has = !!(st.anchor && st.started);
    el.ribbon.hidden = !has;
    if (!has) return;
    const sec = secs[secById.get(st.anchor.sec)];
    const ord = S.ready ? ordOf(st.anchor) : 0;
    const label = (sec ? labelOf(sec) : 'your place') + (ord ? ', page ' + ord : '');
    el.ribbonBtn.setAttribute('aria-label', 'Return to your place: ' + label); el.ribbonBtn.title = 'Your place: ' + label;
    if (S.ribbonMoved) {
      S.ribbonMoved = false;
      if (!reduce.matches && S.state === 'reading') { el.ribbonBtn.classList.remove('settle'); void el.ribbonBtn.offsetWidth; el.ribbonBtn.classList.add('settle'); }
    }
  }
  function returnToPlace() {
    if (!st.anchor || !st.started) return;
    if (S.state === 'cover') { openBook(false); return; }
    if (S.state !== 'reading' || S.busy) return;
    const v = viewIdx(locate(st.anchor));
    if (v !== S.view) turnTo(v); else toast('You are at your place.');
  }
  function ordOf(a) { const pg = S.seq[locate(a)]; return pg && pg.ord ? pg.ord : 0; }

  /* ---------- reading lamp ---------- */
  function setLamp(on, quiet) {
    st.lamp = !!on; document.body.dataset.lamp = on ? 'on' : 'off';
    el.btnLamp.setAttribute('aria-pressed', String(!!on));
    el.btnLamp.setAttribute('aria-label', on ? 'Reading lamp, on. Turn it down' : 'Reading lamp, off. Light it');
    el.btnLamp.title = on ? 'Reading lamp: on (L)' : 'Reading lamp: off (L)';
    if (!quiet) { store.save(); toast(on ? 'The lamp is lit.' : 'The lamp is turned down.', 1600); }
  }

  /* ---------- passages: a gentle pointer to a kept line ---------- */
  function flashPassage(ref) {
    S.flash = { sec: ref.sec, pi: ref.pi, a: ref.a, pi2: ref.pi2, b: ref.b };
    setSlots(S.view);
    clearTimeout(S.flashT);
    S.flashT = setTimeout(() => { S.flash = null; const sel = window.getSelection(); if (!sel || sel.isCollapsed) setSlots(S.view); }, 5600);
  }

  /* ---------- chapters ---------- */
  function goToSection(i) { if (i < 0 || i >= secs.length) return; turnTo(viewIdx(S.secStart[i])); }
  function nextChapter() { const p = primaryPage(); if (!p) { goToSection(0); return; } if (p.sIdx < secs.length - 1) goToSection(p.sIdx + 1); else toast('This is the last chapter.'); }
  function prevChapter() {
    const p = primaryPage(); if (!p) return;
    const startIdx = S.secStart[p.sIdx];
    if (p.idx > startIdx + (S.spread && viewIdx(startIdx) === S.view ? 0 : 0) && viewIdx(startIdx) !== S.view) goToSection(p.sIdx);
    else if (p.sIdx > 0) goToSection(p.sIdx - 1); else turnTo(0);
  }

  /* ---------- contents ---------- */
  function buildToc() {
    const ol = el.tocList; ol.replaceChildren();
    secs.forEach((s, i) => {
      if (i === 2) ol.append(mk('li', 'sep'));
      const li = mk('li'); const b = mk('button'); b.dataset.i = i; b.type = 'button';
      const num = mk('span', 't-num', s.kind === 'chapter' ? s.numeral : '§');
      const nm = mk('span', 't-name2', s.kind === 'chapter' ? (s.title || 'Chapter ' + s.numeral) : s.title);
      const pg = mk('span', 't-pg', String(S.secPages[i][0].ord));
      b.append(num, nm, pg);
      b.setAttribute('aria-label', labelOf(s) + (s.title && s.kind === 'chapter' ? ' — ' + s.title : '') + ', page ' + S.secPages[i][0].ord);
      b.addEventListener('click', () => { closeDrawer(); if (S.state === 'reading') goToSection(i); });
      li.append(b); ol.append(li);
    });
  }

  /* ---------- bookmarks, highlights, notes ---------- */
  function isMarked(p) { return st.bookmarks.some((b) => locate(b) === p.idx); }
  function snippet(p) {
    const sec = secs[p.sIdx]; const it = p.items.find((x) => x.k === 'p');
    if (it) return sec.paragraphs[it.pi].slice(it.a, it.a + 110).trim() + '…';
    const v = p.items.find((x) => x.k === 'v'); return v ? v.text : labelOf(sec);
  }
  function toggleMark(idx) {
    const p = idx != null ? S.seq[idx] : primaryPage();
    if (!p || p.t !== 'text') { toast('Turn to a page of the text to bookmark it.'); return; }
    const had = st.bookmarks.filter((b) => locate(b) === p.idx);
    if (had.length) { st.bookmarks = st.bookmarks.filter((b) => !had.includes(b)); toast('Bookmark removed'); }
    else { st.bookmarks.push({ id: store.uid(), sec: p.sec, pi: p.first.pi, a: p.first.a, label: snippet(p), t: Date.now() }); toast('Page bookmarked'); }
    store.save(); setSlots(S.view); refreshMarkBtn(); renderNotebook();
  }
  function refreshMarkBtn() {
    const p = primaryPage(); const on = !!(p && isMarked(p));
    el.mark.setAttribute('aria-pressed', String(on)); el.mark.setAttribute('aria-label', on ? 'Remove bookmark from this page' : 'Bookmark this page');
  }
  const secLabelById = (id) => { const s = secs[secById.get(id)]; return s ? labelOf(s) : ''; };
  function goAnchor(a) { closeDrawer(); if (S.state === 'reading') turnTo(viewIdx(locate(a))); }
  function renderNotebook() {
    const mp = el.panelMarks, np = el.panelNotes;
    mp.replaceChildren(); np.replaceChildren();
    el.cntMarks.textContent = st.bookmarks.length; el.cntNotes.textContent = st.highlights.length;
    if (!st.bookmarks.length) mp.append(mk('p', 'empty', 'No bookmarks yet. Press B, or use the ribbon button above, to mark the page you are reading.'));
    [...st.bookmarks].sort((x, y) => secById.get(x.sec) - secById.get(y.sec) || x.pi - y.pi || x.a - y.a).forEach((b) => {
      const d = mk('div', 'entry'); const top = mk('div', 'e-top');
      const go = mk('button', 'e-go', secLabelById(b.sec) + (S.seq.length ? ' · p. ' + (S.seq[locate(b)].ord || '') : '')); go.type = 'button'; go.addEventListener('click', () => goAnchor(b));
      const del = mk('button', 'e-del', 'Remove'); del.type = 'button'; del.addEventListener('click', () => { st.bookmarks = st.bookmarks.filter((x) => x.id !== b.id); store.save(); setSlots(S.view); refreshMarkBtn(); renderNotebook(); });
      top.append(go, del); d.append(top, mk('blockquote', '', b.label || '')); mp.append(d);
    });
    if (!st.highlights.length) np.append(mk('p', 'empty', 'Select any passage in the book to highlight it or attach a note.'));
    [...st.highlights].sort((x, y) => secById.get(x.sec) - secById.get(y.sec) || x.pi - y.pi || x.a - y.a).forEach((h) => {
      const d = mk('div', 'entry'); const top = mk('div', 'e-top');
      const go = mk('button', 'e-go', secLabelById(h.sec)); go.type = 'button'; go.addEventListener('click', () => goAnchor(h));
      const del = mk('button', 'e-del', 'Remove'); del.type = 'button'; del.addEventListener('click', () => removeHl(h.id));
      top.append(go, del);
      const ta = mk('textarea'); ta.value = h.note || ''; ta.placeholder = 'Add a note…'; ta.setAttribute('aria-label', 'Note for highlight in ' + secLabelById(h.sec)); ta.maxLength = 2000;
      ta.addEventListener('input', () => { h.note = ta.value; store.save(); });
      ta.addEventListener('change', () => setSlots(S.view));
      d.append(top, mk('blockquote', '', h.text), ta); np.append(d);
    });
  }
  function removeHl(id) { st.highlights = st.highlights.filter((h) => h.id !== id); store.save(); hideNotePop(); setSlots(S.view); renderNotebook(); }
  function offsetIn(pEl, node, off) { const r = document.createRange(); r.selectNodeContents(pEl); r.setEnd(node, off); return r.toString().length; }
  function readSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const sc = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    const pEl = sc && sc.closest ? sc.closest('.p') : null;
    if (!pEl || !el.book.contains(pEl)) return null;
    const base = Number(pEl.dataset.a), end = Number(pEl.dataset.b), pi = Number(pEl.dataset.pi), secId = pEl.dataset.sec;
    const text = secs[secById.get(secId)].paragraphs[pi];
    let a = base + offsetIn(pEl, r.startContainer, r.startOffset);
    let ec = r.endContainer.nodeType === 3 ? r.endContainer.parentElement : r.endContainer;
    let b = ec && ec.closest && ec.closest('.p') === pEl ? base + offsetIn(pEl, r.endContainer, r.endOffset) : end;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b <= a) return null;
    return { sec: secId, pi, a, b, text: text.slice(a, b), rect: r.getBoundingClientRect() };
  }
  let selTimer = 0;
  function onSelection() {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const s = S.state === 'reading' ? readSelection() : null;
      const k = S.state === 'reading' && JE.journal ? JE.journal.readSelection() : null;
      S.pending = s; S.keep = k;
      const canKeep = !!(k && k.ref);
      if (!s && !canKeep) { el.selTool.hidden = true; return; }
      $('selHl').disabled = !s; $('selNote').disabled = !s; $('selKeep').disabled = !canKeep;
      const rect = (s || k).rect;
      el.selTool.hidden = false;
      const w = el.selTool.offsetWidth || 180;
      el.selTool.style.left = clamp(rect.left + rect.width / 2 - w / 2, 8, window.innerWidth - w - 8) + 'px';
      el.selTool.style.top = Math.max(58, rect.top - 46) + 'px';
    }, 120);
  }
  function addHighlight(withNote) {
    const s = S.pending; if (!s) return null;
    if (st.highlights.some((h) => h.sec === s.sec && h.pi === s.pi && h.a < s.b && h.b > s.a)) { toast('That passage overlaps an existing highlight.'); return null; }
    const h = { id: store.uid(), sec: s.sec, pi: s.pi, a: s.a, b: s.b, text: s.text.length > 300 ? s.text.slice(0, 297) + '…' : s.text, note: '', t: Date.now() };
    st.highlights.push(h); store.save();
    window.getSelection().removeAllRanges(); el.selTool.hidden = true; S.pending = null;
    setSlots(S.view); renderNotebook();
    if (withNote) requestAnimationFrame(() => { const n = el.book.querySelector('.hl[data-id="' + h.id + '"]'); if (n) openNotePop(h.id, n); });
    else toast('Highlighted');
    return h;
  }
  function openNotePop(id, anchorEl) {
    const h = st.highlights.find((x) => x.id === id); if (!h) return;
    S.noteFor = id; el.notePopText.value = h.note || '';
    const r = anchorEl.getBoundingClientRect();
    el.notePop.hidden = false;
    const w = el.notePop.offsetWidth;
    el.notePop.style.left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8) + 'px';
    el.notePop.style.top = clamp(r.bottom + 8, 60, window.innerHeight - el.notePop.offsetHeight - 70) + 'px';
    el.notePopText.focus();
  }
  function hideNotePop() {
    if (el.notePop.hidden) return;
    const h = st.highlights.find((x) => x.id === S.noteFor);
    if (h) { h.note = el.notePopText.value.trim(); store.save(); }
    el.notePop.hidden = true; S.noteFor = null; setSlots(S.view); renderNotebook();
  }

  /* ---------- drawers / popovers ---------- */
  const drawers = () => ({ toc: [el.toc, el.btnToc], notes: [el.notebook, el.btnNotes] });
  function openDrawer(name) {
    closeSettings();
    const all = drawers();
    if (S.drawer && S.drawer !== name) closeDrawer(true);
    const [d, b] = all[name]; d.hidden = false;
    void d.offsetWidth; d.classList.add('open'); b.setAttribute('aria-expanded', 'true'); S.drawer = name;
    if (name === 'notes') renderNotebook();
    setTimeout(() => { const f = name === 'toc' ? (d.querySelector('[aria-current="true"]') || d.querySelector('button')) : d.querySelector('[role=tab]'); if (f) { f.focus(); if (f.scrollIntoView) f.scrollIntoView({ block: 'center' }); } }, 60);
  }
  function closeDrawer(quick) {
    if (!S.drawer) return;
    const [d, b] = drawers()[S.drawer]; S.drawer = null;
    d.classList.remove('open'); b.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!d.classList.contains('open')) d.hidden = true; }, quick ? 0 : 380);
    if (!quick) b.focus({ preventScroll: true });
  }
  function toggleDrawer(n) { S.drawer === n ? closeDrawer() : openDrawer(n); }
  function closeSettings() { if (!el.settings.hidden) { el.settings.hidden = true; el.btnSet.setAttribute('aria-expanded', 'false'); } }
  function toggleSettings() {
    if (el.settings.hidden) { closeDrawer(true); el.settings.hidden = false; el.btnSet.setAttribute('aria-expanded', 'true'); el.fsUp.focus(); }
    else { closeSettings(); el.btnSet.focus(); }
  }

  /* ---------- settings ---------- */
  function setTheme(t) {
    if (!store.THEMES.includes(t)) t = 'ivory';
    st.theme = t; document.body.dataset.theme = t; store.save();
    el.settings.querySelectorAll('[role=radio]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === t)));
    const mt = document.querySelector('meta[name=theme-color]'); if (mt) mt.content = t === 'gaslight' ? '#0c0907' : '#1b1512';
  }
  function stepFont(d) {
    const cur = S.m.fs; let i = FS.indexOf(cur); if (i < 0) i = FS.findIndex((x) => x >= cur);
    const ni = clamp(i + d, 0, FS.length - 1); if (FS[ni] === cur) { toast(d > 0 ? 'Largest size' : 'Smallest size'); return; }
    st.fontSize = FS[ni]; store.save(); relayout(true);
  }
  let rzTimer = 0;
  async function relayout(force) {
    finishFlip(); if (S.pauseOpen) { el.pause.hidden = true; S.pauseOpen = false; }
    if (S.ready && !S.pendingAnchor) S.pendingAnchor = st.anchor && visibleIdx().includes(locate(st.anchor)) ? st.anchor : currentAnchor();
    const m = computeMetrics(); const changed = keyOf(m) !== S.key;
    applyMetrics(m);
    if (changed || force) { S.busy = true; try { await repaginate(); } finally { S.busy = false; } }
    else if (S.ready) { S.pendingAnchor = null; setSlots(S.view); }
  }

  /* ---------- opening & closing the cover ---------- */
  const easeOpen = 'cubic-bezier(.5,.02,.2,1)';
  async function openBook(fromStart, jump) {
    if (!S.ready || S.busy || S.state !== 'cover') return;
    S.busy = true; document.body.dataset.state = 'busy'; S.state = 'busy';
    if (fromStart) { st.anchor = null; S.resumeView = 0; }
    S.view = 0; setSlots(0); el.slotA.style.visibility = 'hidden';
    const target = jump ? viewIdx(locate(jump)) : S.resumeView; const keepAnchor = jump ? null : st.anchor;
    const cl = el.coverLeaf; cl.className = 'leaf cover-leaf from-right'; cl.hidden = false;
    const dur = reduce.matches ? 1 : 1500;
    const o = { duration: dur, easing: easeOpen, fill: 'forwards' };
    const a1 = cl.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }], o);
    const a2 = el.wrap.animate([{ transform: poseCss(coverPose()) }, { transform: poseCss(readPose()) }], o);
    const a3 = (S.spread ? el.castB : el.castB).animate([{ opacity: 0 }, { opacity: .8, offset: .35 }, { opacity: 0 }], o);
    await a1.finished.catch(() => 0);
    setPose(readPose());
    S.state = 'reading'; document.body.dataset.state = 'reading';
    el.slotA.style.visibility = ''; setSlots(0);
    [a1, a2, a3].forEach((a) => { try { a.cancel(); } catch (e) { /* noop */ } });
    S.busy = false; afterChange(true); st.started = true; store.save();
    announce('Book opened. ' + (jump ? 'Going to your passage.' : target ? 'Resuming where you left off.' : 'Title page.'));
    if (target > 0) { await new Promise((r) => setTimeout(r, reduce.matches ? 0 : 450)); await turnTo(target, { silent: true }); if (keepAnchor && visibleIdx().includes(locate(keepAnchor))) { st.anchor = keepAnchor; store.save(); } }
    el.next.focus({ preventScroll: true });
  }
  async function closeBook() {
    if (S.state !== 'reading' || S.busy) return;
    finishFlip(); hideNotePop(); closeDrawer(true); closeSettings();
    S.busy = true; store.save(true);
    S.view = 0; setSlots(0);
    S.state = 'busy'; document.body.dataset.state = 'busy';
    const cl = el.coverLeaf; cl.className = 'leaf cover-leaf from-right'; cl.hidden = false;
    const o = { duration: reduce.matches ? 1 : 1300, easing: easeOpen, fill: 'forwards' };
    const a1 = cl.animate([{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }], o);
    const a2 = el.wrap.animate([{ transform: poseCss(readPose()) }, { transform: poseCss(coverPose()) }], o);
    await a1.finished.catch(() => 0);
    S.state = 'cover'; document.body.dataset.state = 'cover'; setPose(coverPose());
    el.slotA.style.visibility = 'hidden';
    [a1, a2].forEach((a) => { try { a.cancel(); } catch (e) { /* noop */ } });
    S.resumeView = st.anchor ? viewIdx(locate(st.anchor)) : 0;
    S.busy = false; updateCoverActions(); updateRibbon(); el.openBtn.focus({ preventScroll: true });
  }
  function updateCoverActions() {
    const has = !!(st.anchor && st.started);
    el.openBtn.textContent = has ? 'Continue Reading' : 'Open the Book';
    el.beginBtn.hidden = !has;
    if (S.ready) {
      if (has) { const s = secs[secById.get(st.anchor.sec)]; el.coverNote.textContent = 'You left off in ' + labelOf(s) + '.'; }
      else el.coverNote.textContent = '';
    }
    el.openBtn.disabled = !S.ready;
    updateRibbon();
  }

  /* ---------- focus mode, fullscreen, timer ---------- */
  function toggleFocus() {
    const on = document.body.classList.toggle('focus');
    el.btnFocus.setAttribute('aria-pressed', String(on));
    toast(on ? 'Distraction-free: bars appear when you move to the edges.' : 'Controls shown');
  }
  function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenEnabled) { toast('Fullscreen is not available here.'); return; }
    if (d.fullscreenElement) d.exitFullscreen(); else d.documentElement.requestFullscreen().catch(() => toast('Fullscreen was blocked.'));
  }
  function updateTimer() {
    const s = st.readSeconds; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    el.timer.textContent = h ? h + 'h ' + m + 'm' : m + 'm';
    el.timer.hidden = !st.timer;
  }
  setInterval(() => {
    if (S.state === 'reading' && !document.hidden && Date.now() - S.lastInput < 120000) {
      st.readSeconds++; if (st.readSeconds % 15 === 0) { store.save(); } if (st.timer && st.readSeconds % 30 === 0) updateTimer();
    }
  }, 1000);

  /* ---------- wiring ---------- */
  function bind() {
    const ids = { wrap: 'bookWrap', book: 'book', slotA: 'slotA', slotB: 'slotB', leaf: 'leaf', coverLeaf: 'coverLeaf', toast: 'toast', live: 'live', veil: 'veil', measure: 'measure',
      openBtn: 'openBtn', beginBtn: 'beginBtn', coverNote: 'coverNote', barChap: 'barChap', infoChap: 'infoChap', infoPage: 'infoPage', scrub: 'scrubber', prev: 'btnPrev', next: 'btnNext',
      prevCh: 'btnPrevCh', nextCh: 'btnNextCh', toc: 'toc', tocList: 'tocList', notebook: 'notebook', btnToc: 'btnToc', btnNotes: 'btnNotes', btnSet: 'btnSet', settings: 'settings', mark: 'btnMark',
      btnFocus: 'btnFocus', btnFull: 'btnFull', timer: 'timer', fsOut: 'fsOut', fsUp: 'fsUp', fsDown: 'fsDown', panelMarks: 'panelMarks', panelNotes: 'panelNotes', cntMarks: 'cntMarks', cntNotes: 'cntNotes',
      selTool: 'selTool', notePop: 'notePop', notePopText: 'notePopText', optTimer: 'optTimer', optAmbient: 'optAmbient', optVol: 'optVol', tabMarks: 'tabMarks', tabNotes: 'tabNotes',
      btnLamp: 'btnLamp', ribbon: 'placeRibbon', ribbonBtn: 'ribbonBtn', pause: 'pause', veilText: 'veilText', veilRetry: 'veilRetry',
      optPageSound: 'optPageSound', optPageVol: 'optPageVol', optPause: 'optPause', soundState: 'soundState' };
    Object.keys(ids).forEach((k) => { el[k] = $(ids[k]); });
    el.castA = document.querySelector('.cast-a'); el.castB = document.querySelector('.cast-b');

    el.openBtn.addEventListener('click', () => openBook(false));
    el.beginBtn.addEventListener('click', () => openBook(true));
    el.prev.addEventListener('click', prev); el.next.addEventListener('click', next);
    $('edgePrev').addEventListener('click', prev); $('edgeNext').addEventListener('click', next);
    el.prevCh.addEventListener('click', prevChapter); el.nextCh.addEventListener('click', nextChapter);
    $('btnCover').addEventListener('click', closeBook);
    el.btnToc.addEventListener('click', () => toggleDrawer('toc'));
    el.btnNotes.addEventListener('click', () => toggleDrawer('notes'));
    el.btnSet.addEventListener('click', toggleSettings);
    el.btnFocus.addEventListener('click', toggleFocus); el.btnFull.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => el.btnFull.setAttribute('aria-pressed', String(!!document.fullscreenElement)));
    el.mark.addEventListener('click', () => toggleMark());
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeDrawer()));
    el.fsUp.addEventListener('click', () => stepFont(1)); el.fsDown.addEventListener('click', () => stepFont(-1));
    el.settings.querySelectorAll('[role=radio]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.theme)));
    el.optTimer.addEventListener('change', () => { st.timer = el.optTimer.checked; store.save(); updateTimer(); });
    el.optAmbient.addEventListener('change', () => {
      if (el.optAmbient.checked) { if (!JE.ambient.start(el.optVol.value / 100)) { el.optAmbient.checked = false; toast('Sound is not available in this browser.'); } } else JE.ambient.stop();
    });
    el.optVol.addEventListener('input', () => JE.ambient.volume(el.optVol.value / 100));
    // page-turn sound (off by default; the audio engine is only created after a real turn with sound on)
    el.optPageSound.addEventListener('change', () => {
      if (el.optPageSound.checked && !(JE.paper && JE.paper.supported())) { el.optPageSound.checked = false; toast('Sound is not available in this browser.'); }
      st.pageSound = el.optPageSound.checked; el.soundState.textContent = st.pageSound ? 'On' : 'Off'; store.save();
    });
    el.optPageVol.addEventListener('input', () => { st.pageVol = el.optPageVol.value / 100; store.save(); });
    el.optPause.addEventListener('change', () => { st.chapterPause = el.optPause.checked; store.save(); });
    el.btnLamp.addEventListener('click', () => setLamp(!st.lamp));
    el.ribbonBtn.addEventListener('click', (e) => { e.stopPropagation(); returnToPlace(); });
    $('pauseGo').addEventListener('click', () => hidePause(true));
    $('pauseStay').addEventListener('click', () => hidePause(false));
    el.veilRetry.addEventListener('click', () => location.reload());
    // scrubber
    el.scrub.addEventListener('input', () => { const o = Number(el.scrub.value); el.infoPage.textContent = 'Page ' + o + ' of ' + S.textTotal; el.scrub.style.setProperty('--fill', (o / S.textTotal * 100) + '%'); });
    el.scrub.addEventListener('change', () => { const idx = S.ordIdx[Number(el.scrub.value)]; if (idx != null) turnTo(viewIdx(idx)); });
    // notebook tabs
    const tab = (which) => { const m = which === 'marks'; el.tabMarks.setAttribute('aria-selected', m); el.tabNotes.setAttribute('aria-selected', !m); el.tabMarks.tabIndex = m ? 0 : -1; el.tabNotes.tabIndex = m ? -1 : 0; el.panelMarks.hidden = !m; el.panelNotes.hidden = m; };
    el.tabMarks.addEventListener('click', () => tab('marks')); el.tabNotes.addEventListener('click', () => tab('notes'));
    [el.tabMarks, el.tabNotes].forEach((t) => t.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const m = t === el.tabNotes; tab(m ? 'marks' : 'notes'); (m ? el.tabMarks : el.tabNotes).focus(); } }));
    // highlights
    document.addEventListener('selectionchange', onSelection);
    el.selTool.addEventListener('mousedown', (e) => e.preventDefault());
    $('selHl').addEventListener('click', () => addHighlight(false));
    $('selNote').addEventListener('click', () => addHighlight(true));
    el.book.addEventListener('click', (e) => { const h = e.target.closest && e.target.closest('.hl'); if (h) openNotePop(h.dataset.id, h); });
    el.book.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('hl')) { e.preventDefault(); e.stopPropagation(); openNotePop(e.target.dataset.id, e.target); } });
    $('npDone').addEventListener('click', hideNotePop);
    $('npDelete').addEventListener('click', () => removeHl(S.noteFor));
    document.addEventListener('pointerdown', (e) => {
      S.lastInput = Date.now();
      if (!el.notePop.hidden && !el.notePop.contains(e.target) && !(e.target.closest && e.target.closest('.hl'))) hideNotePop();
      if (!el.settings.hidden && !el.settings.contains(e.target) && !el.btnSet.contains(e.target)) closeSettings();
    });
    // swipe
    let sx = 0, sy = 0, sId = null;
    el.book.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; sx = e.clientX; sy = e.clientY; sId = e.pointerId; });
    el.book.addEventListener('pointerup', (e) => {
      if (sId !== e.pointerId) return; sId = null;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const sel = window.getSelection(); if (sel && !sel.isCollapsed) return;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)();
    });
    el.book.addEventListener('pointercancel', () => { sId = null; });
    // keyboard
    document.addEventListener('keydown', (e) => {
      S.lastInput = Date.now();
      if (JE.journal && JE.journal.isOpen()) { JE.journal.onKey(e); return; }      // My Passages owns the keyboard while open
      if (S.pauseOpen) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); hidePause(true); }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Escape') { e.preventDefault(); hidePause(false); }
        else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === $('pauseGo') ? $('pauseStay') : $('pauseGo')).focus(); }
        return;
      }
      const t = e.target; const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox');
      if (e.key === 'Escape') {
        if (JE.journal && JE.journal.escape()) return;
        if (!el.notePop.hidden) { hideNotePop(); return; }
        if (!el.settings.hidden) { toggleSettings(); return; }
        if (S.drawer) { closeDrawer(); return; }
        if (document.body.classList.contains('focus')) toggleFocus();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (S.state === 'cover') {
        if (e.key === 'Enter' && document.activeElement === document.body) openBook(false);
        else if (e.key === 'l' || e.key === 'L') setLamp(!st.lamp);
        else if ((e.key === 'm' || e.key === 'M') && JE.journal) JE.journal.toggle();
        return;
      }
      if (S.state !== 'reading') return;
      const onRange = t && t.tagName === 'INPUT' && t.type === 'range';
      const inControl = t && (t.tagName === 'BUTTON' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !onRange));
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': if (onRange && e.key === 'ArrowRight') return; e.preventDefault(); next(); break;
        case 'ArrowLeft': case 'PageUp': if (onRange && e.key === 'ArrowLeft') return; e.preventDefault(); prev(); break;
        case ' ': if (inControl || onRange) return; e.preventDefault(); e.shiftKey ? prev() : next(); break;
        case 'Home': if (onRange) return; e.preventDefault(); turnTo(0); break;
        case 'End': if (onRange) return; e.preventDefault(); turnTo(numViews() - 1); break;
        case '[': prevChapter(); break;
        case ']': nextChapter(); break;
        case 'c': case 'C': toggleDrawer('toc'); break;
        case 'n': case 'N': toggleDrawer('notes'); break;
        case 'b': case 'B': toggleMark(); break;
        case 'f': case 'F': toggleFocus(); break;
        case 'l': case 'L': setLamp(!st.lamp); break;
        case 'm': case 'M': if (JE.journal) JE.journal.toggle(); break;
        case 'p': case 'P': if (JE.journal) JE.journal.keepFromSelection(); break;
        default: break;
      }
    });
    window.addEventListener('resize', () => { clearTimeout(rzTimer); rzTimer = setTimeout(() => relayout(false), 180); });
    window.addEventListener('orientationchange', () => { clearTimeout(rzTimer); rzTimer = setTimeout(() => relayout(false), 300); });
    document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => { if (S.ready && S.fontsSettled && !S.busy) relayout(false); });
  }

  /* ---------- boot ---------- */
  async function boot() {
    bind();
    JE.cover.build(); const dust = JE.cover.dust(); dust.start();
    st = store.load(new Set(secs.map((s) => s.id)));
    setTheme(st.theme);
    el.optTimer.checked = st.timer; updateTimer();
    el.optPageSound.checked = st.pageSound; el.soundState.textContent = st.pageSound ? 'On' : 'Off'; el.optPageVol.value = Math.round(st.pageVol * 100);
    el.optPause.checked = st.chapterPause; setLamp(st.lamp, true);
    if (JE.journal) JE.journal.init({ S, el, secs, secById, labelOf, locate, viewIdx, turnTo: (v, o) => turnTo(v, o), openBook, toast, mk, clamp, closeDrawer, closeSettings, flash: flashPassage, ordOf });
    S.seq = [{ t: 'title' }];
    const m = computeMetrics(); applyMetrics(m); setPose(coverPose()); setSlots(0);
    updateCoverActions();
    const fontLoads = ['400 18px "EB Garamond"', 'italic 400 18px "EB Garamond"', '700 40px "Cormorant Garamond"', '600 16px "Cormorant Garamond"'].map((f) => document.fonts.load(f).catch(() => 0));
    await Promise.race([Promise.all(fontLoads).then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 4000))]);
    S.fontsSettled = true;
    try { await relayoutBoot(); } catch (err) { loadFailed(err); }
  }
  async function relayoutBoot() {
    const m = computeMetrics(); applyMetrics(m);
    await repaginate();
    S.resumeView = st.anchor && st.started ? viewIdx(locate(st.anchor)) : 0;
    updateCoverActions();
    setSlots(S.view); renderNotebook();
    S.booted = true;
    if (JE.journal) JE.journal.refresh();
  }
  JE.app = { returnToPlace, setLamp, flashPassage, maybePause, hidePause, ordOf, S, secs, pageEl, setSlots, locate, next, prev, turnTo, openBook, closeBook, goToSection, nextChapter, prevChapter, relayout, toggleMark, viewIdx, numViews, primaryPage, get st() { return st; } };
  boot();
})(window.JE = window.JE || {});
