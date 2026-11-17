// Short original stingers plus the recorded reaction clips.
// Playback waits for a user gesture, and iOS is nudged onto the media audio session
// so the silent switch does not swallow the soundboard.
window.Sfx = (() => {
  'use strict';
  const KEY = 'kyr-audio';
  const settings = (() => {
    const base = { sfx: true };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved.sfx === 'boolean') return { ...base, ...saved };
    } catch { /* ignore */ }
    return base;
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

  let ctx = null;
  let master = null;
  let sfxBus = null;
  let noiseBuf = null;
  let primed = false;
  let silentEl = null;

  function wake() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || document.hidden) return;
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
  }
  function ac() {
    if (ctx) { wake(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { return null; } }
    ctx.onstatechange = () => { if (ctx.state === 'running') preload(); };
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14;
    master.knee.value = 8;
    master.ratio.value = 3;
    master.attack.value = 0.004;
    master.release.value = 0.2;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfx ? 0.9 : 0;
    sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    wake();
    return ctx;
  }
  const now = () => (ctx ? ctx.currentTime : 0);
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function osc(type, freq, t, stop, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(stop);
    return o;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.14, slide = 0, delay = 0 } = {}) {
    if (!ctx) return;
    const t = now() + delay;
    const g = ctx.createGain();
    g.connect(sfxBus);
    env(g, t, 0.008, vol, Math.max(0.04, dur));
    const o = osc(type, Math.max(40, freq), t, t + dur + 0.05, g);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  }
  function noise(t, dur, dest) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.connect(dest);
    s.start(t);
    s.stop(t + dur + 0.02);
    return s;
  }
  function ready() {
    if (!settings.sfx) return false;
    if (!ac()) return false;
    return ctx.state === 'running' || ctx.state === 'suspended';
  }

  const sampleBuffers = new Map();
  let preloading = false;
  function sampleUrl(file) { return '/' + String(file || '').replace(/^\/+/, ''); }
  function decodeAudio(raw) {
    const copy = raw.slice(0);
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = (buf) => { if (!settled) { settled = true; resolve(buf); } };
      const bad = (err) => { if (!settled) { settled = true; reject(err || new Error('decode')); } };
      try {
        const p = ctx.decodeAudioData(copy, ok, bad);
        if (p && typeof p.then === 'function') p.then(ok, bad);
      } catch (err) { bad(err); }
    });
  }
  function loadSample(file) {
    const url = sampleUrl(file);
    const hit = sampleBuffers.get(url);
    if (hit instanceof AudioBuffer) return Promise.resolve(hit);
    if (hit && typeof hit.then === 'function') return hit;
    const pending = fetch(url).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.arrayBuffer();
    }).then(decodeAudio).then((buf) => {
      sampleBuffers.set(url, buf);
      return buf;
    }).catch((err) => {
      sampleBuffers.delete(url);
      throw err;
    });
    sampleBuffers.set(url, pending);
    return pending;
  }
  function preload() {
    if (!ctx || ctx.state !== 'running' || preloading) return;
    preloading = true;
    const list = window.REACTIONS || [];
    list.forEach((r) => { if (r && r.file) loadSample(r.file).catch(() => {}); });
  }
  function playSample(file, gain) {
    const start = (buf) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = typeof gain === 'number' ? gain : 1;
      src.connect(g);
      g.connect(sfxBus);
      src.start();
    };
    const hit = sampleBuffers.get(sampleUrl(file));
    if (hit instanceof AudioBuffer) { start(hit); return; }
    loadSample(file).then((buf) => {
      if (!settings.sfx || !ctx) return;
      start(buf);
    }).catch(() => {});
  }
  const fx = {
    tone(opts) { tone(opts.freq || 440, opts.dur || 0.15, opts); },
    burst({ dur = 0.18, vol = 0.1, delay = 0, freq = 900, freqTo = 1800 } = {}) {
      if (!ctx) return;
      const t = now() + delay;
      const g = ctx.createGain();
      g.connect(sfxBus);
      env(g, t, 0.005, vol, dur);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(80, freqTo), t + dur);
      f.connect(g);
      noise(t, dur, f);
    },
    voice() {},
    duck() {},
  };

  function setSession() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch { /* ignore */ }
  }
  function silentWavURL() {
    const n = 4000;
    const b = new ArrayBuffer(44 + n);
    const d = new DataView(b);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) d.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); d.setUint32(4, 36 + n, true); w(8, 'WAVEfmt ');
    d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, 8000, true); d.setUint32(28, 8000, true);
    d.setUint16(32, 1, true); d.setUint16(34, 8, true);
    w(36, 'data'); d.setUint32(40, n, true);
    for (let i = 0; i < n; i++) d.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function keepSilentTrack() {
    if (!isIOS || document.hidden || !settings.sfx) return;
    try {
      if (!silentEl) {
        silentEl = document.createElement('audio');
        silentEl.setAttribute('playsinline', '');
        silentEl.setAttribute('webkit-playsinline', '');
        silentEl.preload = 'auto';
        silentEl.loop = true;
        silentEl.src = silentWavURL();
      }
      if (silentEl.paused) {
        const p = silentEl.play();
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* ignore */ }
  }
  function prime() {
    if (primed || !ctx) return;
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      primed = true;
    } catch { /* ignore */ }
  }
  function onGesture() {
    setSession();
    ac();
    prime();
    keepSilentTrack();
    if (ctx && ctx.state === 'running') preload();
  }
  ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'click', 'keydown'].forEach((ev) => {
    window.addEventListener(ev, onGesture, { capture: true, passive: true });
  });
  setSession();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
      if (silentEl && !silentEl.paused) { try { silentEl.pause(); } catch { /* ignore */ } }
    } else { wake(); keepSilentTrack(); }
  });
  window.addEventListener('pageshow', () => { if (!document.hidden) { wake(); keepSilentTrack(); } });

  function chime(notes) {
    if (!ready()) return;
    ac();
    notes.forEach(([freq, delay, dur]) => tone(freq, dur || 0.16, { type: 'triangle', vol: 0.12, delay }));
  }

  return {
    get muted() { return !settings.sfx; },
    unlock() { onGesture(); },
    toggle() {
      settings.sfx = !settings.sfx;
      save();
      if (ctx && sfxBus) sfxBus.gain.setTargetAtTime(settings.sfx ? 0.9 : 0, now(), 0.03);
      if (settings.sfx) { onGesture(); tone(660, 0.08, { type: 'sine', vol: 0.1 }); }
      return settings.sfx;
    },
    playReaction(id) {
      if (!settings.sfx) return;
      if (!ac()) return;
      preload();
      const list = window.REACTIONS || [];
      const r = list.find((x) => x.id === id);
      if (!r) return;
      try {
        if (r.file) playSample(r.file, r.gain);
        if (typeof r.play === 'function') r.play(fx);
      } catch { /* a bad sound never breaks the game */ }
    },
    pop() { if (ready()) chime([[520, 0, 0.08], [780, 0.06, 0.1]]); },
    lock() { if (ready()) tone(440, 0.09, { type: 'triangle', vol: 0.12, slide: 220 }); },
    drumroll() {
      if (!ready()) return;
      ac();
      for (let i = 0; i < 10; i++) tone(180 + i * 18, 0.05, { type: 'square', vol: 0.035, delay: i * 0.07 });
    },
    tada() { if (ready()) chime([[523, 0, 0.12], [659, 0.1, 0.14], [784, 0.2, 0.28]]); },
    winner() { if (ready()) chime([[392, 0, 0.14], [523, 0.14, 0.14], [659, 0.28, 0.16], [784, 0.42, 0.4]]); },
  };
})();
