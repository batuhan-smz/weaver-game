/**
 * sounds.js — file-backed SFX with stronger Web Audio fallbacks.
 *
 * Drop custom files under:
 *   /www/assets/sfx/<effect>/<effect>.mp3
 *
 * Example:
 *   /www/assets/sfx/lineclear/lineclear.mp3
 */

let _ctx          = null;
let _masterGain   = null;
let _masterVolume = parseFloat(localStorage.getItem('weaverMasterVolume') ?? '0.7');
let _sfxVolume    = parseFloat(localStorage.getItem('weaverSfxVolume') ?? '1');
let _musicVolume  = parseFloat(localStorage.getItem('weaverMusicVolume') ?? '0.35');
let _bgmAudio     = null;
let _bgmProbe     = null;
let _skipFileSfx  = false;

const SFX_BASE = './assets/sfx';
const MUSIC_URL = './assets/music/theme.mp3';
const _fileMap = {
  place:      'place/place.mp3',
  lineclear:  'lineclear/lineclear.mp3',
  cluster:    'clusterburst/clusterburst.mp3',
  mega:       'megaweaver/megaweaver.mp3',
  clean:      'clean/clean.mp3',
};
const _availability = new Map();
const _rarePlayCounters = new Map();

function _clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function _effectiveSfxVolume() {
  return _clamp01(_masterVolume * _sfxVolume);
}

function _effectiveMusicVolume() {
  return _clamp01(_masterVolume * _musicVolume);
}

function _syncSfxGain() {
  if (_masterGain) _masterGain.gain.value = _effectiveSfxVolume();
}

function _syncMusicVolume() {
  if (!_bgmAudio) return;
  const volume = _effectiveMusicVolume();
  _bgmAudio.volume = volume;
  if (volume <= 0) {
    _bgmAudio.pause();
    return;
  }
  _bgmAudio.play().catch(() => {});
}

function _shouldPlaySometimes(key, every = 10) {
  const count = (_rarePlayCounters.get(key) ?? 0) + 1;
  _rarePlayCounters.set(key, count);
  return count % every === 0;
}

export function setMasterVolume(v) {
  _masterVolume = _clamp01(v);
  localStorage.setItem('weaverMasterVolume', String(_masterVolume));
  _syncSfxGain();
  _syncMusicVolume();
}

export function getMasterVolume() { return _masterVolume; }

export function setSfxVolume(v) {
  _sfxVolume = _clamp01(v);
  localStorage.setItem('weaverSfxVolume', String(_sfxVolume));
  _syncSfxGain();
}

export function getSfxVolume() { return _sfxVolume; }

export function setMusicVolume(v) {
  _musicVolume = _clamp01(v);
  localStorage.setItem('weaverMusicVolume', String(_musicVolume));
  _syncMusicVolume();
}

export function getMusicVolume() { return _musicVolume; }

export function setSkipFileSfx(skip) {
  _skipFileSfx = !!skip;
}

export function getSkipFileSfx() { return _skipFileSfx; }

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

function resume() {
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  if (!_masterGain) {
    _masterGain = ctx.createGain();
    _masterGain.gain.value = _effectiveSfxVolume();
    _masterGain.connect(ctx.destination);
  }
  return ctx;
}

function dest() { resume(); return _masterGain ?? getCtx().destination; }

export function prepareBackgroundMusic() {
  if (_bgmAudio) return Promise.resolve(true);
  if (_bgmProbe) return _bgmProbe;

  _bgmProbe = fetch(MUSIC_URL, { method: 'HEAD' })
    .then(r => r.ok)
    .catch(() => false)
    .then(ok => {
      if (!ok) return false;
      const audio = new Audio(MUSIC_URL);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = _effectiveMusicVolume();
      _bgmAudio = audio;
      return true;
    });

  return _bgmProbe;
}

export function resumeAudio() {
  const ctx = resume();
  prepareBackgroundMusic().then(ok => {
    if (ok) _syncMusicVolume();
  }).catch(() => {});
  return ctx;
}

function _sfxUrl(key) {
  const rel = _fileMap[key];
  return rel ? `${SFX_BASE}/${rel}` : null;
}

function _probeFile(key) {
  const url = _sfxUrl(key);
  if (!url || _availability.has(key)) return;
  const promise = fetch(url, { method: 'HEAD' })
    .then(r => r.ok)
    .catch(() => false);
  _availability.set(key, promise);
}

function _playFile(key) {
  if (_skipFileSfx) return false;
  const volume = _effectiveSfxVolume();
  if (volume <= 0) return true;
  const known = _availability.get(key);
  if (known !== true) {
    if (!known) {
      _probeFile(key);
      const pending = _availability.get(key);
      if (pending) {
        pending.then(ok => _availability.set(key, ok)).catch(() => _availability.set(key, false));
      }
    }
    return false;
  }

  try {
    const audio = new Audio(_sfxUrl(key));
    audio.volume = volume;
    audio.preload = 'auto';
    audio.play().catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

function _tone(ctx, type, freq, start, duration, gainValue, endFreq = null) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(dest());
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq && endFreq > 0) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
  }
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.start(start);
  osc.stop(start + duration);
}

function _fallbackPlace() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    _tone(ctx, 'triangle', 190, t, 0.09, 0.18, 120);
    _tone(ctx, 'sine', 95, t, 0.11, 0.12, 65);
  } catch (_) {}
}

function _fallbackClear() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    _tone(ctx, 'triangle', 280, t, 0.22, 0.20, 140);
    _tone(ctx, 'triangle', 420, t + 0.045, 0.20, 0.16, 210);
    _tone(ctx, 'sine', 120, t, 0.25, 0.14, 72);
  } catch (_) {}
}

function _fallbackCluster() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    [260, 330, 440, 620].forEach((freq, idx) => {
      _tone(ctx, 'sine', freq, t + idx * 0.04, 0.22, 0.12, freq * 1.6);
    });
  } catch (_) {}
}

function _fallbackMega() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    [220, 330, 523.25, 659.25, 880].forEach((freq, idx) => {
      _tone(ctx, idx < 2 ? 'sawtooth' : 'square', freq, t + idx * 0.05, 0.35, 0.10, freq * 1.15);
    });
  } catch (_) {}
}

function _fallbackClean() {
  try {
    const ctx = resume();
    const t = ctx.currentTime;
    [392, 523.25, 783.99].forEach((freq, idx) => {
      _tone(ctx, 'triangle', freq, t + idx * 0.07, 0.28, 0.12, freq * 1.08);
    });
    _tone(ctx, 'sine', 130.81, t, 0.32, 0.10, 98);
  } catch (_) {}
}

export function playPlace() {
  if (_playFile('place')) return;
  _fallbackPlace();
}

export function playClear() {
  if (!_shouldPlaySometimes('lineclear')) return;
  if (_playFile('lineclear')) return;
  _fallbackClear();
}

export function playCluster() {
  if (!_shouldPlaySometimes('cluster')) return;
  if (_playFile('cluster')) return;
  _fallbackCluster();
}

export function playMega() {
  if (_playFile('mega')) return;
  _fallbackMega();
}

export function playClean() {
  if (_playFile('clean')) return;
  _fallbackClean();
}
