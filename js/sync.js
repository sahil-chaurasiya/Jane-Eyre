/* Sync & backup. Keeps reading position, bookmarks, highlights and My Passages the same on every device.
   Device-specific preferences (type size, paper, sounds, lamp) deliberately stay local.
   Works offline: the app only ever reads localStorage; this module copies to/from the cloud in the background. */
(function (JE) {
  'use strict';
  const RK = 'jane-eyre:reader', PK = 'jane-eyre:passages', MK = 'jane-eyre:sync';
  const $ = (id) => document.getElementById(id);
  const J = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  let meta = Object.assign({ id: '', lastIds: [], tomb: {}, localMod: 0, lastHash: '', lastSync: 0 }, J(get(MK)) || {});
  let pushT = 0, busy = false, dirty = false, lastPush = 0, status = '';
  const saveMeta = () => put(MK, JSON.stringify(meta));

  async function sha(text) {
    const b = new TextEncoder().encode('jane-eyre-sync-v1:' + text.trim());
    const h = await crypto.subtle.digest('SHA-256', b);
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  /* what is synced */
  function snapshot() {
    const r = J(get(RK)) || {}, p = J(get(PK)) || {};
    return {
      anchor: r.anchor || null, readSeconds: r.readSeconds || 0, started: r.started === true,
      bookmarks: Array.isArray(r.bookmarks) ? r.bookmarks : [], highlights: Array.isArray(r.highlights) ? r.highlights : [],
      passages: Array.isArray(p.passages) ? p.passages : []
    };
  }
  const idsOf = (s) => [...s.bookmarks, ...s.highlights, ...s.passages].map((x) => x && x.id).filter(Boolean);
  const hashOf = (s) => JSON.stringify([s.anchor, s.started, s.bookmarks, s.highlights, s.passages]);

  /* union by id, remove deletions (tombstones), the newer side wins on conflicts */
  function merge(local, remote, localWins) {
    const tomb = Object.assign({}, remote.tomb || {}, meta.tomb);
    for (const k of Object.keys(remote.tomb || {})) tomb[k] = Math.max((remote.tomb || {})[k] || 0, meta.tomb[k] || 0);
    const first = localWins ? local : remote.snap, second = localWins ? remote.snap : local;
    const uni = (key) => {
      const m = new Map();
      [second[key], first[key]].forEach((arr) => (arr || []).forEach((x) => { if (x && x.id && !tomb[x.id]) m.set(x.id, x); }));
      return [...m.values()];
    };
    return { snap: {
      anchor: first.anchor || second.anchor, started: first.started || second.started, readSeconds: Math.max(first.readSeconds || 0, second.readSeconds || 0),
      bookmarks: uni('bookmarks'), highlights: uni('highlights'), passages: uni('passages')
    }, tomb };
  }
  function detectDeletes(snap) {
    const now = new Set(idsOf(snap)), t = Date.now();
    meta.lastIds.forEach((id) => { if (!now.has(id)) meta.tomb[id] = t; });
    Object.keys(meta.tomb).forEach((k) => { if (t - meta.tomb[k] > 90 * 864e5) delete meta.tomb[k]; });
  }
  /* write merged data into the app's own records, leaving device preferences untouched */
  function applyLocal(snap) {
    const r = J(get(RK)) || { v: 1 };
    Object.assign(r, { v: 1, anchor: snap.anchor, started: snap.started, readSeconds: snap.readSeconds, bookmarks: snap.bookmarks, highlights: snap.highlights });
    window.__jeFrozen = true;                       // stop the running page from overwriting what we just wrote
    put(RK, JSON.stringify(r)); put(PK, JSON.stringify({ v: 1, passages: snap.passages }));
  }

  async function api(method, body) {
    const r = await fetch('/api/sync?id=' + meta.id, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', keepalive: !!body && body.keep });
    if (r.status === 503) throw new Error('not-configured');
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }
  const canReload = () => !(JE.app && JE.app.S && (JE.app.S.state === 'reading' || JE.app.S.state === 'busy'));

  /* one round: pull, merge, push if needed, apply if the cloud had news */
  async function run(opts) {
    opts = opts || {};
    if (!meta.id || busy) return;
    busy = true; setStatus('Syncing…');
    try {
      const local = snapshot(); detectDeletes(local);
      const res = await api('GET');
      const remote = res.data;
      let out, changedLocal = false, needPush = true;
      if (!remote) { out = { snap: local, tomb: meta.tomb }; }
      else {
        const localWins = !opts.remoteWins && (opts.localWins || meta.localMod > (remote.updated || 0));
        out = merge(local, { snap: remote.snap || {}, tomb: remote.tomb }, localWins);
        changedLocal = hashOf(out.snap) !== hashOf(local) || (out.snap.readSeconds !== local.readSeconds && out.snap.readSeconds > local.readSeconds + 120);
        needPush = JSON.stringify([out.snap.anchor, out.snap.bookmarks, out.snap.highlights, out.snap.passages, out.tomb]) !== JSON.stringify([(remote.snap || {}).anchor, (remote.snap || {}).bookmarks, (remote.snap || {}).highlights, (remote.snap || {}).passages, remote.tomb]);
      }
      meta.tomb = out.tomb;
      if (needPush || opts.force) await api('PUT', { data: { v: 1, updated: Math.max(meta.localMod, remote ? remote.updated || 0 : 0, Date.now() * (needPush ? 1 : 0)), snap: out.snap, tomb: out.tomb }, keep: !!opts.keep });
      meta.lastIds = idsOf(out.snap); meta.lastSync = Date.now(); dirty = false;
      if (changedLocal) {
        applyLocal(out.snap); meta.lastHash = hashOf(out.snap); saveMeta();
        if (canReload() || opts.reload) { location.reload(); return; }
        setStatus('Newer data arrived from another device. It will appear next time you open the book.');
      } else { meta.lastHash = hashOf(local); saveMeta(); setStatus(''); }
      refreshUi();
    } catch (e) {
      setStatus(e.message === 'not-configured' ? 'Cloud sync is not set up on this website yet.' : 'Could not reach the cloud. Your data is safe here and will sync later.');
      refreshUi(e.message);
    } finally { busy = false; }
  }
  function touch() {            // called every few seconds: notice local changes, push soon
    if (!meta.id) return;
    const h = hashOf(snapshot());
    if (h !== meta.lastHash) { meta.lastHash = h; meta.localMod = Date.now(); dirty = true; saveMeta(); }
    if (dirty && !busy && Date.now() - lastPush > 20000) { lastPush = Date.now(); run(); }
  }

  /* ---------- UI ---------- */
  function setStatus(t) { status = t; const s = $('syncStatus'); if (s) s.textContent = t; }
  function refreshUi() {
    const on = !!meta.id;
    $('syncOff').hidden = on; $('syncOn').hidden = !on;
    const when = meta.lastSync ? new Date(meta.lastSync).toLocaleString() : 'not yet';
    $('syncInfo').textContent = on ? 'Connected. Last synced: ' + when : '';
    const cs = $('coverSync'); if (cs) cs.textContent = on ? 'Synced' : 'Sync devices';
    const b = $('btnSync'); if (b) b.textContent = on ? 'Synced ✓ · manage' : 'Sync & backup…';
    $('syncStatus').textContent = status;
  }
  const dlg = () => $('syncDlg');
  function open() { if (JE.app && JE.app.closeSettings) JE.app.closeSettings(); refreshUi(); dlg().hidden = false; document.body.classList.add('journal-open'); (meta.id ? $('syncNow') : $('syncPhrase')).focus(); }
  function close() { dlg().hidden = true; document.body.classList.remove('journal-open'); }
  async function connect() {
    const ph = $('syncPhrase').value;
    if (ph.trim().length < 10) { setStatus('Please use a phrase of at least 10 characters (a few words is best).'); refreshUi(); return; }
    try { meta.id = await sha(ph); } catch (e) { setStatus('This browser cannot do secure sync (needs https).'); return; }
    meta.lastIds = []; meta.tomb = meta.tomb || {}; meta.localMod = 0; meta.lastHash = hashOf(snapshot()); saveMeta();
    $('syncPhrase').value = '';
    await run({ reload: true });
    refreshUi();
  }
  function disconnect() { meta = { id: '', lastIds: [], tomb: {}, localMod: 0, lastHash: '', lastSync: 0 }; saveMeta(); setStatus('Disconnected. Your data stays in this browser.'); refreshUi(); }
  function exportFile() {
    const data = JSON.stringify({ app: 'jane-eyre', exported: new Date().toISOString(), [RK]: get(RK), [PK]: get(PK) }, null, 1);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = 'jane-eyre-backup.json'; document.body.append(a); a.click(); a.remove();
  }
  function importText() {
    const raw = $('syncImport').value.trim(); if (!raw) { setStatus('Paste a backup first.'); return; }
    let o = J(raw);
    if (!o || typeof o !== 'object') { setStatus('That does not look like a backup.'); return; }
    const r = typeof o[RK] === 'string' ? J(o[RK]) : (o.v === 1 && (o.highlights || o.bookmarks || o.anchor) ? o : null);
    const p = typeof o[PK] === 'string' ? J(o[PK]) : null;
    if (!r && !p) { setStatus('No Jane Eyre data found in that text.'); return; }
    const mine = snapshot();
    const incoming = { anchor: r ? r.anchor || null : null, started: !!(r && r.started), readSeconds: r ? r.readSeconds || 0 : 0, bookmarks: r && Array.isArray(r.bookmarks) ? r.bookmarks : [], highlights: r && Array.isArray(r.highlights) ? r.highlights : [], passages: p && Array.isArray(p.passages) ? p.passages : [] };
    const out = merge(mine, { snap: incoming, tomb: {} }, false);
    meta.localMod = Date.now();
    applyLocal(out.snap); meta.lastHash = ''; saveMeta();
    setStatus('Imported. Reloading…'); setTimeout(() => location.reload(), 400);
  }
  function init() {
    $('btnSync').addEventListener('click', open); $('coverSync').addEventListener('click', open);
    $('syncClose').addEventListener('click', close);
    $('syncConnect').addEventListener('click', connect);
    $('syncPhrase').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
    $('syncNow').addEventListener('click', () => run({ force: true }));
    $('syncOffBtn').addEventListener('click', disconnect);
    $('syncExport').addEventListener('click', exportFile);
    $('syncImportBtn').addEventListener('click', importText);
    dlg().addEventListener('mousedown', (e) => { if (e.target === dlg()) close(); });
    dlg().addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    refreshUi();
    if (meta.id) {
      meta.lastHash = meta.lastHash || hashOf(snapshot());
      run();
      setInterval(touch, 4000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); else if (dirty) run({ keep: true }); });
      window.addEventListener('pagehide', () => { touch(); if (dirty && !busy) run({ keep: true }); });
      window.addEventListener('online', () => run());
    }
  }
  JE.sync = { init, open, close, run, merge, snapshot, get meta() { return meta; }, sha };
})(window.JE = window.JE || {});