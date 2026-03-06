/**
 * sounds.js — Synthesized game sounds using Web Audio API.
 * No external files required.
 */

let _ctx = null;

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

function resume() {
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/**
 * Short sine "thud" — block placement.
 */
export function playPlace() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.start(t); osc.stop(t + 0.12);
  } catch (_) {}
}

/**
 * Deep tonal "tok" — row/column cleared.
 */
export function playClear() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'triangle';
      const freq = i === 0 ? 440 : 660;
      osc.frequency.setValueAtTime(freq, t + i * 0.07);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + i * 0.07 + 0.20);
      gain.gain.setValueAtTime(0.20, t + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.22);
      osc.start(t + i * 0.07); osc.stop(t + i * 0.07 + 0.22);
    }
  } catch (_) {}
}

/**
 * Rising chord — color cluster burst.
 */
export function playCluster() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    const freqs = [330, 440, 550, 660];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + i * 0.05);
      osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + i * 0.05 + 0.25);
      gain.gain.setValueAtTime(0.15, t + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.30);
      osc.start(t + i * 0.05); osc.stop(t + i * 0.05 + 0.30);
    });
  } catch (_) {}
}

/**
 * Multi-note fanfare — mega weaver (both rows+cols+cluster at once).
 */
export function playMega() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.50];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, t + i * 0.08);
      gain.gain.setValueAtTime(0.12, t + i * 0.08);
      gain.gain.setValueAtTime(0.12, t + i * 0.08 + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.45);
      osc.start(t + i * 0.08); osc.stop(t + i * 0.08 + 0.45);
    });
  } catch (_) {}
}
