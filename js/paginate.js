/* Pagination engine. Pages are built by *measuring* real text in the real page-text CSS at the real page width,
   in whole line units, so nothing is clipped. Paragraphs split only at spaces (never inside a word), with
   orphan/widow control (>= 2 lines on either side of a split). */
(function (JE) {
  'use strict';
  const MIN_LINES = 2;

  function Paginator(host, m) {
    this.m = m;
    this.host = host;               // hidden element carrying the page-text styles
    host.style.width = m.tw + 'px';
    this.probe = document.createElement('p');
    host.appendChild(this.probe);
  }
  Paginator.prototype.lines = function (el) {
    return Math.max(1, Math.ceil(el.offsetHeight / this.m.lh - 0.04));
  };
  Paginator.prototype.probeLines = function (text, cls) {
    const p = this.probe;
    p.className = 'p ' + cls;
    p.textContent = text;
    return this.lines(p);
  };

  // text[a..e) with e the greatest candidate end whose rendering fits in k lines
  Paginator.prototype.fit = function (text, spaces, a, k, cls, cpl, noLimit) {
    const cands = [];
    const limit = cpl && !noLimit ? a + k * cpl * 1.4 + 20 : Infinity;
    for (let i = 0; i < spaces.length; i++) { if (spaces[i] > a) { cands.push(spaces[i]); if (spaces[i] > limit) break; } }
    if (!cands.length) return -1;
    let lo = 0, hi = cands.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const ln = this.probeLines(text.slice(a, cands[mid]), cls);
      if (ln <= k) { best = mid; this.bestLines = ln; lo = mid + 1; } else hi = mid - 1;
    }
    if (best === cands.length - 1 && cands[best] < text.length && limit !== Infinity) return this.fit(text, spaces, a, k, cls, cpl, true);
    return best < 0 ? -1 : cands[best];
  };

  // Paginate one section -> array of pages {sec, items, first:{pi,a}}
  Paginator.prototype.section = function (sec, sIdx) {
    const m = this.m, N = m.N;
    const H = Math.min(m.headLines, N - 6);
    const host = this.host;
    // 1) batch-measure every block in one layout pass
    const frag = document.createDocumentFragment();
    const els = [];
    sec.paragraphs.forEach((p, pi) => {
      if (typeof p === 'string') {
        const e = document.createElement('p');
        e.className = 'p' + (pi === 0 ? ' first dc' : '');
        e.textContent = p; frag.appendChild(e); els.push([e]);
      } else if (p.verse) {
        const list = [];
        p.verse.forEach((st) => st.forEach((ln) => { const e = document.createElement('p'); e.className = 'vl'; e.textContent = ln; frag.appendChild(e); list.push(e); }));
        els.push(list);
      } else { const e = document.createElement('p'); e.className = 'sig'; e.textContent = p.sig; frag.appendChild(e); els.push([e]); }
    });
    host.appendChild(frag);
    const lineCounts = els.map((list) => list.map((e) => this.lines(e)));
    els.forEach((list) => list.forEach((e) => e.remove()));

    const pages = [];
    let cur = null;
    const newPage = (isFirst) => { cur = { sec: sec.id, sIdx, items: [], used: isFirst ? H : 0, first: null }; if (isFirst) cur.items.push({ k: 'head' }); pages.push(cur); };
    const note = (pi, a) => { if (!cur.first) cur.first = { pi, a }; };
    newPage(true);

    sec.paragraphs.forEach((p, pi) => {
      if (typeof p === 'string') {
        const text = p;
        let spaces = null;
        const sp = () => spaces || (spaces = (function () { const r = []; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 32) r.push(i); r.push(text.length); return r; })());
        let a = 0;
        let total = lineCounts[pi][0];
        const cpl = text.length / total;
        let isFirstFrag = true;
        while (true) {
          const cls = (pi === 0 && isFirstFrag ? 'first dc' : isFirstFrag ? '' : 'cont');
          const remaining = N - cur.used;
          if (total <= remaining) {
            note(pi, a);
            cur.items.push({ k: 'p', pi, a, b: text.length, cls: (pi === 0 && isFirstFrag ? 'first dc' : (isFirstFrag ? '' : 'cont')) });
            cur.used += total;
            break;
          }
          // does not fit entirely: split if >= MIN_LINES fit, else start a fresh page
          let k = remaining;
          if (k >= MIN_LINES) {
            if (total - k < MIN_LINES) k = total - MIN_LINES;      // widow control
            if (k >= MIN_LINES) {
              const e = this.fit(text, sp(), a, k, cls, cpl);
              if (e > a) {
                note(pi, a);
                cur.items.push({ k: 'p', pi, a, b: e, cls: cls + ' more' });
                cur.used += this.bestLines;
                a = e + 1;
                isFirstFrag = false;
                total = this.probeLines(text.slice(a), 'cont');
                newPage(false);
                continue;
              }
            }
          }
          if (cur.used === 0 || (cur.items.length === 1 && cur.items[0].k === 'head')) {
            // pathological (tiny page): force a split with whatever fits
            const e = this.fit(text, sp(), a, Math.max(1, remaining), cls);
            const cut = e > a ? e : text.length;
            note(pi, a); cur.items.push({ k: 'p', pi, a, b: cut, cls: cls + (cut < text.length ? ' more' : '') });
            if (cut >= text.length) break;
            a = cut + 1; isFirstFrag = false; total = this.probeLines(text.slice(a), 'cont'); newPage(false); continue;
          }
          newPage(false);
        }
      } else if (p.verse) {
        let li = 0;
        let prevEndedStanza = false;
        p.verse.forEach((st, si) => {
          st.forEach((ln, sj) => {
            const need = lineCounts[pi][li];
            const gap = sj === 0 && si > 0 ? 1 : 0;
            const stanzaStartGap = sj === 0 && si === 0 ? 0 : 0;
            if (cur.used + gap + need > N) newPage(false);
            const atTop = cur.used === 0;
            const g = atTop ? 0 : gap;
            // a verse block opening after prose gets a half-line breathing gap via CSS (visual only)
            note(pi, 0);
            cur.items.push({ k: 'v', pi, si, sj, li, text: ln, gap: g === 1, lead: si === 0 && sj === 0 });
            cur.used += g + need; li++;
          });
        });
        void prevEndedStanza;
      } else {
        const gap = 1;
        if (cur.used + gap + lineCounts[pi][0] > N) newPage(false);
        const g = cur.used === 0 ? 0 : (cur.items[cur.items.length - 1].k === 'sig' ? 0 : gap);
        note(pi, 0);
        cur.items.push({ k: 'sig', pi, text: p.sig, gap: g === 1 });
        cur.used += g + lineCounts[pi][0];
      }
    });
    // drop a trailing empty page (can only be a just-opened one)
    if (pages.length > 1 && pages[pages.length - 1].items.length === 0) pages.pop();
    pages.forEach((pg) => { if (!pg.first) pg.first = { pi: 0, a: 0 }; });
    return pages;
  };

  JE.Paginator = Paginator;
})(window.JE = window.JE || {});
