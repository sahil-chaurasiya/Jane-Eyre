/* Persistence: one versioned, validated localStorage record. Corrupt / outdated data falls back to defaults. */
(function (JE) {
  'use strict';
  const KEY = 'jane-eyre:reader';
  const VERSION = 1;
  const THEMES = ['ivory', 'vellum', 'moor', 'gaslight'];
  const defaults = () => ({
    v: VERSION, anchor: null, fontSize: null, theme: 'ivory',
    ambient: false, timer: false, readSeconds: 0, started: false,
    bookmarks: [], highlights: [],
    lamp: false, pageSound: false, pageVol: 0.5, chapterPause: false
  });
  const isStr = (x) => typeof x === 'string';
  const isInt = (x) => Number.isInteger(x) && x >= 0;
  function cleanAnchor(a) {
    return a && typeof a === 'object' && isStr(a.sec) && isInt(a.pi) && isInt(a.a) ? { sec: a.sec, pi: a.pi, a: a.a } : null;
  }
  function sanitize(raw, validSecs) {
    const d = defaults();
    if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return d;
    const ok = (id) => !validSecs || validSecs.has(id);
    const an = cleanAnchor(raw.anchor);
    d.anchor = an && ok(an.sec) ? an : null;
    d.fontSize = Number.isFinite(raw.fontSize) && raw.fontSize >= 12 && raw.fontSize <= 34 ? raw.fontSize : null;
    d.theme = THEMES.includes(raw.theme) ? raw.theme : 'ivory';
    d.ambient = false; // never auto-start sound, whatever was stored
    d.timer = raw.timer === true;
    d.started = raw.started === true;
    d.readSeconds = Number.isFinite(raw.readSeconds) && raw.readSeconds >= 0 ? Math.floor(raw.readSeconds) : 0;
    // optional extras (additive: records saved before they existed simply fall back to the defaults)
    d.lamp = raw.lamp === true;
    d.pageSound = raw.pageSound === true;
    d.pageVol = Number.isFinite(raw.pageVol) && raw.pageVol >= 0 && raw.pageVol <= 1 ? raw.pageVol : 0.5;
    d.chapterPause = raw.chapterPause === true;
    if (Array.isArray(raw.bookmarks)) {
      d.bookmarks = raw.bookmarks.filter((b) => b && isStr(b.id) && isStr(b.sec) && ok(b.sec) && isInt(b.pi) && isInt(b.a))
        .map((b) => ({ id: b.id, sec: b.sec, pi: b.pi, a: b.a, label: isStr(b.label) ? b.label.slice(0, 160) : '', t: Number(b.t) || 0 }));
    }
    if (Array.isArray(raw.highlights)) {
      d.highlights = raw.highlights.filter((h) => h && isStr(h.id) && isStr(h.sec) && ok(h.sec) && isInt(h.pi) && isInt(h.a) && isInt(h.b) && h.b > h.a)
        .map((h) => ({ id: h.id, sec: h.sec, pi: h.pi, a: h.a, b: h.b, text: isStr(h.text) ? h.text.slice(0, 400) : '', note: isStr(h.note) ? h.note.slice(0, 2000) : '', t: Number(h.t) || 0 }));
    }
    return d;
  }
  let state = defaults();
  let timer = null;
  function load(validSecs) {
    try { state = sanitize(JSON.parse(localStorage.getItem(KEY)), validSecs); } catch (e) { state = defaults(); }
    return state;
  }
  function flush() {
    timer = null;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode / quota: carry on without persistence */ }
  }
  function save(immediate) {
    if (immediate) { clearTimeout(timer); flush(); return; }
    if (!timer) timer = setTimeout(flush, 250);
  }
  JE.store = { load, save, get state() { return state; }, sanitize, KEY, THEMES, uid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4) };
  window.addEventListener('pagehide', () => save(true));
})(window.JE = window.JE || {});
