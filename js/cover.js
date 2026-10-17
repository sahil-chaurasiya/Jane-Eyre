/* Cover art (original illustration: moonlit manor, lit window, moor) + drifting dust motes */
(function (JE) {
  'use strict';
  /* The front-cover artwork is a supplied illustration (img/jane-eyre-cover.*). Its title and author are part of the image. */
  const COVER_ALT = 'Jane Eyre by Charlotte Brontë: a woman on a moonlit moor looking toward a distant manor with one lit window';

  function build() {
    const f = document.getElementById('coverFront');
    f.innerHTML = '<div class="cover"><picture>' +
      '<source type="image/webp" srcset="img/jane-eyre-cover.webp">' +
      '<img class="cv-img" src="img/jane-eyre-cover.jpg" width="1024" height="1536" alt="' + COVER_ALT + '" decoding="async" draggable="false">' +
      '</picture><div class="cv-bevel" aria-hidden="true"></div><div class="cv-grain" aria-hidden="true"></div></div>';
    const img = f.querySelector('.cv-img');
    const fallback = () => {          // artwork missing: fall back to a typeset cloth cover so the book still reads as Jane Eyre
      if (f.querySelector('.cv-fb')) return;
      const t = document.createElement('div'); t.className = 'cv-fb';
      t.innerHTML = '<span class="cv-fb-t">Jane Eyre</span><span class="cv-fb-a">Charlotte Brontë</span>';
      f.querySelector('.cover').append(t); img.hidden = true;
    };
    img.addEventListener('error', fallback);
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) fallback();
  }

  /* dust motes lit by the lamp: slow upward drift, soft twinkle */
  function dust() {
    const cv = document.getElementById('dust'); const ctx = cv.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let W = 0, H = 0, dpr = 1, parts = [], raf = 0, running = false, last = 0;
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(70, W * H / 22000));
      parts = Array.from({ length: n }, () => spawn(true));
    }
    function spawn(any) {
      return { x: Math.random() * W, y: any ? Math.random() * H : H + 10, r: .5 + Math.random() * 1.7, vy: -(4 + Math.random() * 11), vx: (Math.random() - .5) * 6, ph: Math.random() * 6.28, sp: .4 + Math.random() * 1.2 };
    }
    function frame(t) {
      if (!running) return;
      const dt = Math.min(.05, (t - last) / 1000 || .016); last = t;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H * .4, R = Math.min(W, H) * .6;
      for (const p of parts) {
        p.x += (p.vx + Math.sin(t / 2400 + p.ph) * 3) * dt; p.y += p.vy * dt;
        if (p.y < -10 || p.x < -10 || p.x > W + 10) Object.assign(p, spawn(false), { x: Math.random() * W });
        const d = Math.hypot(p.x - cx, (p.y - cy) * 1.2) / R;
        const lit = Math.max(.12, 1 - d);
        const a = lit * (.25 + .5 * (.5 + .5 * Math.sin(t / 1000 * p.sp + p.ph)));
        ctx.beginPath(); ctx.fillStyle = 'rgba(255,224,170,' + a.toFixed(3) + ')'; ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running || reduce.matches) { if (reduce.matches) paintStatic(); return; }
      running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }
    function paintStatic() {
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) { ctx.beginPath(); ctx.fillStyle = 'rgba(255,224,170,.28)'; ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }
    }
    size();
    window.addEventListener('resize', () => { size(); if (!running) paintStatic(); });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    return { start, stop };
  }
  JE.cover = { build, dust };
})(window.JE = window.JE || {});
