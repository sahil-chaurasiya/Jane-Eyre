/* My Passages: a private collection of kept quotations. Its own versioned localStorage record, separate from the
   reading-progress record (so neither can clobber the other). A passage points into the book data by
   section id + paragraph index + character offsets, so it survives repagination and font-size changes. */
(function (JE) {
  'use strict';
  const KEY = 'jane-eyre:passages';
  const BACKUP = 'jane-eyre:passages:backup';
  const VERSION = 1;
  const MAX_TEXT = 2000, MAX_NOTE = 2000;
  const MOODS = [
    { id: 'heartbreak', label: 'Heartbreak' }, { id: 'hope', label: 'Hope' }, { id: 'longing', label: 'Longing' },
    { id: 'anger', label: 'Anger' }, { id: 'peace', label: 'Peace' }, { id: 'remember', label: 'A line worth remembering' }
  ];
  const moodIds = MOODS.map((m) => m.id);
  const isStr = (x) => typeof x === 'string';
  const isInt = (x) => Number.isInteger(x) && x >= 0;
  let list = [], timer = null, warned = false, onFail = null, loadNote = '';

  function clean(p, validSecs) {
    if (!p || typeof p !== 'object') return null;
    if (!isStr(p.id) || !p.id || !isStr(p.sec) || (validSecs && !validSecs.has(p.sec))) return null;
    if (!isInt(p.pi) || !isInt(p.a) || !isInt(p.pi2) || !isInt(p.b)) return null;
    if (p.pi2 < p.pi || (p.pi2 === p.pi && p.b <= p.a)) return null;
    if (!isStr(p.text) || !p.text.trim() || p.text.length > MAX_TEXT) return null;
    return {
      id: p.id, sec: p.sec, pi: p.pi, a: p.a, pi2: p.pi2, b: p.b, text: p.text,
      mood: moodIds.includes(p.mood) ? p.mood : '',
      note: isStr(p.note) ? p.note.slice(0, MAX_NOTE) : '',
      t: Number.isFinite(p.t) ? p.t : 0,
      label: isStr(p.label) ? p.label.slice(0, 80) : '', title: isStr(p.title) ? p.title.slice(0, 120) : '',
      ord: isInt(p.ord) ? p.ord : 0
    };
  }
  function parse(raw, validSecs) {
    if (raw == null) return { list: [], dropped: 0, bad: false };
    let o; try { o = JSON.parse(raw); } catch (e) { return { list: [], dropped: 0, bad: true }; }
    if (!o || typeof o !== 'object' || o.v !== VERSION || !Array.isArray(o.passages)) return { list: [], dropped: 0, bad: true };
    const out = o.passages.map((p) => clean(p, validSecs)).filter(Boolean);
    return { list: out, dropped: o.passages.length - out.length, bad: false };
  }
  function load(validSecs) {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    const r = parse(raw, validSecs);
    list = r.list; loadNote = '';
    // never silently destroy something we could not read: keep the original under a backup key
    if ((r.bad || r.dropped) && raw != null) {
      try { if (!localStorage.getItem(BACKUP)) localStorage.setItem(BACKUP, raw); } catch (e) { /* ignore */ }
      loadNote = r.bad ? 'Your saved passages could not be read. A copy was kept aside and the collection starts empty.' : r.dropped + ' saved passage' + (r.dropped > 1 ? 's' : '') + ' could not be restored.';
    }
    return list;
  }
  function flush() {
    timer = null;
    try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, passages: list })); return true; }
    catch (e) { if (!warned && onFail) { warned = true; onFail(); } return false; }
  }
  function save(now) { if (now) { clearTimeout(timer); return flush(); } if (!timer) timer = setTimeout(flush, 200); return true; }
  const sameRef = (x, y) => x.sec === y.sec && x.pi === y.pi && x.a === y.a && x.pi2 === y.pi2 && x.b === y.b;
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function add(p) { const c = clean(Object.assign({ id: uid() }, p), null); if (!c) return null; list.push(c); save(true); return c; }
  function find(id) { return list.find((p) => p.id === id) || null; }
  function findRef(r) { return list.find((p) => sameRef(p, r)) || null; }
  function update(id, patch) {
    const p = find(id); if (!p) return null;
    if ('mood' in patch) p.mood = moodIds.includes(patch.mood) ? patch.mood : '';
    if ('note' in patch) p.note = String(patch.note || '').slice(0, MAX_NOTE);
    save(); return p;
  }
  function remove(id) { const i = list.findIndex((p) => p.id === id); if (i < 0) return null; const [p] = list.splice(i, 1); save(true); return { p, i }; }
  function restore(p, i) { if (!p || find(p.id)) return; list.splice(Math.min(i, list.length), 0, p); save(true); }
  window.addEventListener('pagehide', () => { if (timer) save(true); });
  JE.passages = {
    MOODS, moodLabel: (id) => (MOODS.find((m) => m.id === id) || {}).label || '', load, add, find, findRef, update, remove, restore, save,
    get list() { return list; }, get loadNote() { return loadNote; }, sameRef, parse, KEY, BACKUP, MAX_TEXT,
    onFail(fn) { onFail = fn; }, reload(validSecs) { return load(validSecs); }
  };
})(window.JE = window.JE || {});
