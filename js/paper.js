/* Page-turn sound: a short, soft paper rustle synthesised with Web Audio (no audio files, nothing to fail to load).
   Off by default. The AudioContext is only ever created after the reader has turned the sound on and turned a page,
   i.e. inside a genuine user gesture. Any failure is swallowed: reading carries on silently. */
(function (JE) {
  'use strict';
  let ctx = null, master = null, noise = null, busyUntil = 0, dead = false;
  function ensure() {
    if (dead) return false;
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { dead = true; return false; }
      ctx = new AC(); master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.9), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * .35 + w * .65; d[i] = last; }
      noise = buf; return true;
    } catch (e) { dead = true; ctx = null; return false; }
  }
  /* dir: 1 forward, -1 back. vol 0..1. far: a longer riffle for jumps of several pages. */
  function play(dir, vol, far) {
    try {
      if (!ensure()) return false;
      if (ctx.state === 'suspended') ctx.resume().catch(() => 0);
      const now = ctx.currentTime;
      if (now < busyUntil) return false;                       // never overlap: rapid turns stay a single rustle
      const dur = far ? 0.62 : 0.4;
      busyUntil = now + dur + 0.05;
      const v = Math.max(0, Math.min(1, vol)) * 0.5;
      const src = ctx.createBufferSource(); src.buffer = noise;
      src.playbackRate.value = dir > 0 ? 1 : 0.9;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.6;
      bp.frequency.setValueAtTime(dir > 0 ? 2600 : 4200, now); bp.frequency.linearRampToValueAtTime(dir > 0 ? 4400 : 2600, now + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now);
      // a soft swell, then a few small paper "ticks" riding on it, then a gentle tail
      g.gain.exponentialRampToValueAtTime(v, now + dur * 0.28);
      g.gain.setTargetAtTime(v * 0.35, now + dur * 0.35, dur * 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 22; const lg = ctx.createGain(); lg.gain.value = v * 0.35;
      lfo.connect(lg); lg.connect(g.gain);
      src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(master);
      src.start(now, Math.random() * 0.25, dur + 0.05); lfo.start(now); lfo.stop(now + dur + 0.05);
      src.onended = () => { try { src.disconnect(); hp.disconnect(); bp.disconnect(); g.disconnect(); lg.disconnect(); } catch (e) { /* gone */ } };
      return true;
    } catch (e) { return false; }
  }
  function dispose() { try { if (ctx) ctx.close(); } catch (e) { /* noop */ } ctx = null; master = null; noise = null; }
  window.addEventListener('pagehide', dispose);
  JE.paper = { play, supported: () => !!(window.AudioContext || window.webkitAudioContext) && !dead, dispose };
})(window.JE = window.JE || {});
