/* Optional ambient sound: synthesised rain on glass + a quiet hearth crackle (no audio files). Off by default. */
(function (JE) {
  'use strict';
  let ctx = null, master = null, running = false, crackleTimer = 0, nodes = [];
  function noiseBuffer(seconds, brown) {
    const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return buf;
  }
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    // rain: filtered white noise
    const rain = ctx.createBufferSource(); rain.buffer = noiseBuffer(4, false); rain.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    const rg = ctx.createGain(); rg.gain.value = .16;
    rain.connect(hp); hp.connect(lp); lp.connect(rg); rg.connect(master); rain.start();
    // distant wind: brown noise swelling slowly
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuffer(6, true); wind.loop = true;
    const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 380;
    const wg = ctx.createGain(); wg.gain.value = .35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = .07; const lg = ctx.createGain(); lg.gain.value = .22;
    lfo.connect(lg); lg.connect(wg.gain); lfo.start();
    wind.connect(wl); wl.connect(wg); wg.connect(master); wind.start();
    nodes = [rain, wind, lfo];
    return true;
  }
  function crackle() {
    if (!running) return;
    const t = ctx.currentTime, n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(.05, false);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200 + Math.random() * 2600; f.Q.value = 2;
      const g = ctx.createGain(); const at = t + i * (.02 + Math.random() * .05);
      g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(.18 + Math.random() * .25, at + .003); g.gain.exponentialRampToValueAtTime(.0001, at + .04);
      s.connect(f); f.connect(g); g.connect(master); s.start(at);
    }
    crackleTimer = setTimeout(crackle, 600 + Math.random() * 2600);
  }
  JE.ambient = {
    supported: () => !!(window.AudioContext || window.webkitAudioContext),
    start(vol) {
      if (!ctx && !build()) return false;
      if (ctx.state === 'suspended') ctx.resume();
      running = true; this.volume(vol);
      clearTimeout(crackleTimer); crackleTimer = setTimeout(crackle, 800);
      return true;
    },
    stop() {
      running = false; clearTimeout(crackleTimer);
      if (ctx && master) { master.gain.setTargetAtTime(0, ctx.currentTime, .25); setTimeout(() => { if (!running && ctx) ctx.suspend(); }, 900); }
    },
    volume(v) { if (ctx && master) master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * .9, ctx.currentTime, .15); }
  };
})(window.JE = window.JE || {});
