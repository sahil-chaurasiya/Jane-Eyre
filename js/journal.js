/* My Passages: selecting and keeping lines, the journal view, and exact navigation back into the novel.
   Everything refers to the book data (section id, paragraph index, character offsets), never to a page number,
   so a saved passage still points at the right words after a font-size change or repagination. */
(function (JE) {
  'use strict';
  const P = JE.passages;
  let api = null;
  const $ = (id) => document.getElementById(id);
  const ui = { open: false, mood: '', sort: 'recent', query: '', editId: null, kp: null, undo: null, undoT: 0, opener: null, validSecs: null };
  const norm = (s) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  const secIdx = (p) => { const i = api.secById.get(p.sec); return i == null ? 9999 : i; };
  const secOf = (p) => api.secs[api.secById.get(p.sec)] || null;

  /* ---------- reading a selection into a stable reference ---------- */
  function offsetIn(pEl, node, off) { const r = document.createRange(); r.selectNodeContents(pEl); r.setEnd(node, off); return r.toString().length; }
  function textOf(sec, pi, a, pi2, b) {
    const arr = sec.paragraphs;
    if (pi === pi2) return arr[pi].slice(a, b);
    const parts = [arr[pi].slice(a)];
    for (let k = pi + 1; k < pi2; k++) parts.push(arr[k]);
    parts.push(arr[pi2].slice(0, b));
    return parts.join('\n\n');
  }
  function readSelection() {
    if (!api || api.S.state !== 'reading' || api.S.busy) return null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0), root = api.el.book;
    if (!root.contains(r.commonAncestorContainer) && r.commonAncestorContainer !== root) return null;
    const pieces = [];
    root.querySelectorAll('.pt .p').forEach((p) => {
      if (!r.intersectsNode(p)) return;
      const base = Number(p.dataset.a), end = Number(p.dataset.b);
      let a = base, b = end;
      if (p.contains(r.startContainer)) a = base + offsetIn(p, r.startContainer, r.startOffset);
      if (p.contains(r.endContainer)) b = base + offsetIn(p, r.endContainer, r.endOffset);
      if (b > a) pieces.push({ sec: p.dataset.sec, pi: Number(p.dataset.pi), a, b });
    });
    if (!pieces.length) return null;
    const first = pieces[0], last = pieces[pieces.length - 1];
    if (pieces.some((x) => x.sec !== first.sec)) return { err: 'Please keep a passage from one chapter at a time.' };
    const sec = api.secs[api.secById.get(first.sec)];
    let { pi, a } = first, pi2 = last.pi, b = last.b;
    if (pi2 < pi) return null;
    for (let k = pi; k <= pi2; k++) if (typeof sec.paragraphs[k] !== 'string') return { err: 'Verse and signature lines cannot be kept yet. Select within the prose.' };
    const A = sec.paragraphs[pi], B = sec.paragraphs[pi2];
    while (a < A.length && /\s/.test(A[a])) a++;
    if (a >= A.length && pi < pi2) { pi++; a = 0; while (a < sec.paragraphs[pi].length && /\s/.test(sec.paragraphs[pi][a])) a++; }
    while (b > 0 && /\s/.test(B[b - 1])) b--;
    if (b <= 0 && pi2 > pi) { pi2--; b = sec.paragraphs[pi2].length; while (b > 0 && /\s/.test(sec.paragraphs[pi2][b - 1])) b--; }
    if (pi2 < pi || (pi2 === pi && b <= a)) return null;
    const text = textOf(sec, pi, a, pi2, b);
    if (text.replace(/\s/g, '').length < 3) return null;
    if (text.length > P.MAX_TEXT) return { err: 'That is a long stretch. Please keep passages under about 2,000 characters.' };
    return { ref: { sec: first.sec, pi, a, pi2, b }, text, rect: r.getBoundingClientRect() };
  }

  /* ---------- keep popover ---------- */
  function moodChips(host, current, onPick, withNone) {
    host.replaceChildren();
    const mk = api.mk;
    const add = (id, label, cls) => {
      const b = mk('button', 'mood-chip' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.setAttribute('role', 'radio');
      if (id) b.dataset.mood = id; b.dataset.id = id; b.setAttribute('aria-checked', String(current === id));
      b.addEventListener('click', () => onPick(id === current && id ? '' : id));
      host.append(b);
    };
    P.MOODS.forEach((m) => add(m.id, m.label));
    if (withNone) add('', 'No mood', 'none');
  }
  function placeKeep(rect) {
    const kp = $('keepPop'); const w = kp.offsetWidth, h = kp.offsetHeight;
    if (window.innerWidth <= 560) return;
    let top = rect.bottom + 10; if (top + h > window.innerHeight - 20) top = Math.max(60, rect.top - h - 10);
    kp.style.left = api.clamp(rect.left + rect.width / 2 - w / 2, 8, window.innerWidth - w - 8) + 'px';
    kp.style.top = api.clamp(top, 58, window.innerHeight - h - 12) + 'px';
  }
  function openKeep(sel) {
    if (!sel || !sel.ref) return;
    const dup = P.findRef(sel.ref);
    ui.kp = { sel, id: dup ? dup.id : null, mood: dup ? dup.mood : '' };
    $('kpTitle').textContent = dup ? 'Already kept: change its mood or note' : 'Keep this passage';
    $('kpKeep').textContent = dup ? 'Save' : 'Keep';
    $('kpQuote').textContent = sel.text.length > 170 ? sel.text.slice(0, 167).trimEnd() + '…' : sel.text;
    $('kpNote').value = dup ? dup.note : '';
    const draw = () => moodChips($('kpMoods'), ui.kp.mood, (m) => { ui.kp.mood = m; draw(); const c = $('kpMoods').querySelector('[aria-checked="true"]') || $('kpMoods').firstChild; if (c) c.focus(); }, false);
    draw();
    $('selTool').hidden = true;
    const kp = $('keepPop'); kp.hidden = false; placeKeep(sel.rect);
    $('kpKeep').focus({ preventScroll: true });
  }
  function hideKeep() { if ($('keepPop').hidden) return; $('keepPop').hidden = true; ui.kp = null; }
  function commitKeep() {
    const k = ui.kp; if (!k) return;
    const note = $('kpNote').value.trim();
    if (k.id) { P.update(k.id, { mood: k.mood, note }); api.toast('Passage updated'); }
    else {
      const sec = api.secs[api.secById.get(k.sel.ref.sec)];
      const c = P.add({ ...k.sel.ref, text: k.sel.text, mood: k.mood, note, t: Date.now(), label: api.labelOf(sec), title: sec.kind === 'chapter' ? (sec.title || '') : '', ord: api.ordOf({ sec: k.sel.ref.sec, pi: k.sel.ref.pi, a: k.sel.ref.a }) });
      if (!c) { api.toast('That passage could not be kept.'); hideKeep(); return; }
      api.toast('Kept in My Passages');
    }
    const sel = window.getSelection(); if (sel) sel.removeAllRanges();
    hideKeep(); refreshCover(); if (ui.open) render();
  }
  function keepFromSelection() {
    if (!api || api.S.state !== 'reading') return;
    const s = readSelection();
    if (s && s.ref) openKeep(s);
    else api.toast(s && s.err ? s.err : 'Select a line in the book first, then press P to keep it.', 3200);
  }

  /* ---------- the journal view ---------- */
  function resolve(p) {
    const sec = secOf(p); if (!sec) return { ok: false };
    const arr = sec.paragraphs;
    if (typeof arr[p.pi] !== 'string' || typeof arr[p.pi2] !== 'string' || p.a >= arr[p.pi].length || p.b > arr[p.pi2].length) return { ok: false };
    for (let k = p.pi; k <= p.pi2; k++) if (typeof arr[k] !== 'string') return { ok: false };
    return { ok: textOf(sec, p.pi, p.a, p.pi2, p.b) === p.text };
  }
  function chapterLine(p) {
    const sec = secOf(p);
    if (!sec) return p.label + (p.title ? ' · ' + p.title : '');
    return api.labelOf(sec) + (sec.kind === 'chapter' && sec.title ? ' · ' + sec.title : '');
  }
  function visible() {
    let L = P.list.slice();
    if (ui.mood) L = L.filter((p) => p.mood === ui.mood);
    const q = norm(ui.query.trim());
    if (q) L = L.filter((p) => norm(p.text + ' ' + p.note + ' ' + chapterLine(p)).includes(q));
    const order = (a, b) => secIdx(a) - secIdx(b) || a.pi - b.pi || a.a - b.a;
    L.sort(ui.sort === 'recent' ? (a, b) => b.t - a.t || order(a, b) : order);
    return L;
  }
  const fmtDate = (t) => { try { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } };
  function keepEl(p) {
    const mk = api.mk;
    const art = mk('article', 'keep'); if (p.mood) art.dataset.mood = p.mood; art.dataset.id = p.id;
    if (p.mood) art.append(mk('p', 'k-mood', P.moodLabel(p.mood)));
    const bq = mk('blockquote', 'k-text'); bq.tabIndex = 0; bq.setAttribute('role', 'link');
    bq.setAttribute('aria-label', 'Read this passage in the book (' + chapterLine(p) + '): ' + p.text.slice(0, 80));
    p.text.split('\n\n').forEach((t) => bq.append(mk('p', '', t)));
    bq.addEventListener('click', (e) => { if (!String(window.getSelection()).length) goTo(p); else e.stopPropagation(); });
    bq.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goTo(p); } });
    art.append(bq);
    if (p.note) art.append(mk('p', 'k-note', p.note));
    const meta = mk('p', 'k-meta'); meta.append(mk('span', '', chapterLine(p)));
    const ord = api.S.ready ? api.ordOf({ sec: p.sec, pi: p.pi, a: p.a }) : 0; if (ord) meta.append(mk('span', '', 'p. ' + ord));
    meta.append(mk('span', 'k-date', 'Kept ' + fmtDate(p.t)));
    if (!resolve(p).ok) meta.append(mk('span', 'k-warn', 'Cannot be located exactly; it will open at the chapter.'));
    art.append(meta);
    const acts = mk('div', 'k-actions');
    const go = mk('button', 'k-go', 'Read in the book'); go.type = 'button'; go.addEventListener('click', () => goTo(p));
    const ed = mk('button', 'k-ed', p.mood || p.note ? 'Edit mood & note' : 'Add mood & note'); ed.type = 'button';
    ed.setAttribute('aria-expanded', String(ui.editId === p.id));
    ed.addEventListener('click', () => { ui.editId = ui.editId === p.id ? null : p.id; render(); const b = $('jBody').querySelector('[data-id="' + p.id + '"] .k-ed'); if (b) b.focus(); });
    const del = mk('button', 'k-del', 'Remove'); del.type = 'button'; del.addEventListener('click', () => removeOne(p));
    acts.append(go, ed, del); art.append(acts);
    if (ui.editId === p.id) {
      const box = mk('div', 'k-edit'); const lab = mk('label', '', 'Mood'); const row = mk('div', 'mood-row'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', 'Mood');
      moodChips(row, p.mood, (m) => { P.update(p.id, { mood: m }); render(); const c = $('jBody').querySelector('[data-id="' + p.id + '"] .k-edit [aria-checked="true"]') || $('jBody').querySelector('[data-id="' + p.id + '"] .k-edit .mood-chip'); if (c) c.focus(); }, true);
      const nl = mk('label', '', 'Your note'); const ta = mk('textarea'); ta.value = p.note; ta.maxLength = 2000; ta.placeholder = 'A thought to leave beside this line…'; ta.id = 'note-' + p.id; nl.htmlFor = ta.id;
      ta.addEventListener('input', () => P.update(p.id, { note: ta.value }));
      ta.addEventListener('blur', () => { P.save(true); });
      const done = mk('button', 'k-ed', 'Done'); done.type = 'button'; done.style.marginTop = '.5rem';
      done.addEventListener('click', () => { P.update(p.id, { note: ta.value }); P.save(true); ui.editId = null; render(); const b = $('jBody').querySelector('[data-id="' + p.id + '"] .k-ed'); if (b) b.focus(); });
      box.append(lab, row, nl, ta, done); art.append(box);
    }
    return art;
  }
  function render() {
    const body = $('jBody'), mk = api.mk;
    $('jSortRecent').setAttribute('aria-pressed', String(ui.sort === 'recent')); $('jSortOrder').setAttribute('aria-pressed', String(ui.sort === 'order'));
    $('jMoods').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.id || '') === ui.mood)));
    const total = P.list.length; $('jTools').hidden = total === 0;
    body.replaceChildren();
    if (!total) {
      const e = mk('div', 'j-empty'); e.append(mk('span', 'orn'), mk('h3', '', 'Nothing kept yet'),
        mk('p', '', 'This is where the lines you love will gather. While you read, select a few words, then choose Keep passage (or press P). You can give each one a mood and a note of your own.'),
        mk('p', '', 'Your passages are stored only in this browser.'));
      body.append(e); return;
    }
    const L = visible();
    body.append(mk('p', 'j-count', L.length === total ? total + (total === 1 ? ' passage' : ' passages') : L.length + ' of ' + total));
    if (!L.length) {
      const e = mk('div', 'j-empty'); e.append(mk('h3', '', 'No passages match'), mk('p', '', 'Try a different word, or another mood.'));
      const c = mk('button', '', 'Clear search and filter'); c.type = 'button'; c.addEventListener('click', () => { ui.mood = ''; ui.query = ''; $('jSearch').value = ''; render(); });
      e.append(c); body.append(e); return;
    }
    L.forEach((p, i) => { body.append(keepEl(p)); if (i < L.length - 1) body.append(mk('span', 'k-sep')); });
  }
  function refreshCover() {
    const n = P.list.length, b = $('coverPassages');
    b.hidden = n === 0; b.textContent = 'My Passages (' + n + ')';
    $('btnPassages').setAttribute('aria-label', n ? 'My Passages, ' + n + ' kept' : 'My Passages');
  }
  function openJournal() {
    if (ui.open || !api) return;
    api.closeDrawer(true); api.closeSettings(); hideKeep();
    ui.opener = document.activeElement; ui.open = true;
    $('journal').hidden = false; document.body.classList.add('journal-open');
    $('btnPassages').setAttribute('aria-expanded', 'true');
    render(); $('jClose').focus({ preventScroll: true });
  }
  function closeJournal(skipFocus) {
    if (!ui.open) return;
    ui.open = false; ui.editId = null; P.save(true);
    $('journal').hidden = true; document.body.classList.remove('journal-open'); $('btnPassages').setAttribute('aria-expanded', 'false');
    clearTimeout(ui.undoT); $('jUndo').hidden = true; ui.undo = null;
    const o = ui.opener; ui.opener = null;
    if (!skipFocus && o && document.contains(o) && o.offsetParent !== null) o.focus({ preventScroll: true });
  }
  function removeOne(p) {
    const r = P.remove(p.id); if (!r) return;
    ui.undo = r; if (ui.editId === p.id) ui.editId = null;
    $('jUndoText').textContent = 'Passage removed.'; $('jUndo').hidden = false;
    clearTimeout(ui.undoT); ui.undoT = setTimeout(() => { $('jUndo').hidden = true; ui.undo = null; }, 8000);
    render(); refreshCover();
    if (!P.list.length) $('jClose').focus({ preventScroll: true });
  }
  function undoRemove() {
    if (!ui.undo) return; P.restore(ui.undo.p, ui.undo.i); ui.undo = null; clearTimeout(ui.undoT); $('jUndo').hidden = true; render(); refreshCover();
  }

  /* ---------- exact navigation back into the novel ---------- */
  const idle = async (ms) => { const t0 = Date.now(); while (api.S.busy && Date.now() - t0 < (ms || 2500)) await new Promise((r) => setTimeout(r, 40)); };
  async function goTo(p) {
    if (!api.S.ready) { api.toast('The book is still being set. One moment…'); return; }
    if (api.S.state === 'busy') return;
    const ok = resolve(p).ok;
    const anchor = ok ? { sec: p.sec, pi: p.pi, a: p.a } : { sec: p.sec, pi: 0, a: 0 };
    closeJournal(true);
    if (api.S.state === 'cover') await api.openBook(false, anchor);
    else if (api.S.state === 'reading') {
      await idle();
      const v = api.viewIdx(api.locate(anchor));
      if (v !== api.S.view) await api.turnTo(v);
    } else return;
    if (!ok) { api.toast('That line could not be found exactly. Opened at its chapter.', 3200); return; }
    api.flash({ sec: p.sec, pi: p.pi, a: p.a, pi2: p.pi2, b: p.b });
    const endView = api.viewIdx(api.locate({ sec: p.sec, pi: p.pi2, a: Math.max(0, p.b - 1) }));
    if (endView !== api.S.view) api.toast('This passage continues on the next page.', 3400);
    const nx = $('btnNext'); if (nx && !nx.disabled) nx.focus({ preventScroll: true });
  }

  /* ---------- keyboard while the journal is open ---------- */
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeJournal(); return; }
    if (e.key !== 'Tab') return;
    const f = [...$('journal').querySelectorAll('button,[href],input,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!$('journal').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
  function escape() { if (!$('keepPop').hidden) { hideKeep(); return true; } if (ui.open) { closeJournal(); return true; } return false; }

  function init(a) {
    api = a;
    ui.validSecs = new Set(api.secs.map((s) => s.id));
    P.onFail(() => api.toast('Passages cannot be saved in this browsing mode.', 4000));
    P.load(ui.validSecs);
    if (P.loadNote) setTimeout(() => api.toast(P.loadNote, 5000), 600);
    const mf = $('jMoods'); mf.replaceChildren();
    const mkF = (id, label) => { const b = api.mk('button', 'mood-chip', label); b.type = 'button'; b.dataset.id = id; if (id) b.dataset.mood = id; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', () => { ui.mood = ui.mood === id ? '' : id; render(); }); mf.append(b); };
    const all = api.mk('button', 'mood-chip none', 'All'); all.type = 'button'; all.dataset.id = ''; all.setAttribute('aria-pressed', 'true'); all.addEventListener('click', () => { ui.mood = ''; render(); }); mf.append(all);
    P.MOODS.forEach((m) => mkF(m.id, m.label));
    $('jClose').addEventListener('click', () => closeJournal());
    $('jSearch').addEventListener('input', () => { ui.query = $('jSearch').value; render(); });
    $('jSortRecent').addEventListener('click', () => { ui.sort = 'recent'; render(); });
    $('jSortOrder').addEventListener('click', () => { ui.sort = 'order'; render(); });
    $('jUndoBtn').addEventListener('click', undoRemove);
    $('journal').addEventListener('mousedown', (e) => { if (e.target === $('journal')) closeJournal(); });
    $('btnPassages').addEventListener('click', () => (ui.open ? closeJournal() : openJournal()));
    $('coverPassages').addEventListener('click', openJournal);
    $('selKeep').addEventListener('click', () => { const s = readSelection(); if (s && s.ref) openKeep(s); });
    $('kpKeep').addEventListener('click', commitKeep);
    $('kpCancel').addEventListener('click', hideKeep);
    $('kpNote').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitKeep(); } });
    document.addEventListener('pointerdown', (e) => {
      const kp = $('keepPop'); if (kp.hidden) return;
      if (!kp.contains(e.target) && !$('selTool').contains(e.target)) hideKeep();
    });
    window.addEventListener('storage', (e) => { if (e.key === P.KEY) { P.reload(ui.validSecs); refreshCover(); if (ui.open) render(); } });
    refreshCover();
  }
  JE.journal = { init, readSelection, openKeep, keepFromSelection, open: openJournal, close: closeJournal, toggle: () => (ui.open ? closeJournal() : openJournal()), isOpen: () => ui.open, escape, hideKeep, onKey, refresh: () => { refreshCover(); if (ui.open) render(); } };
})(window.JE = window.JE || {});
