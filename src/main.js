/**
 * main.js - Game orchestrator with start menu, economy, skins, and bottom nav.
 */

import { Grid }                        from './grid.js';
import { generateTray, COLORS as PALETTE } from './blocks.js';
import { Renderer }          from './renderer.js';
import { runClearingLogic }  from './clearing.js';
import { ScoreSystem }       from './score.js';
import { ParticleSystem }    from './particles.js';
import { isGameOver }        from './gameover.js';
import { SKINS, EconomyStore } from './skins.js';
import { POWERUPS, MarketStore } from './market.js';
import { playPlace, playClear, playCluster, playMega, setSfxVolume, getSfxVolume } from './sounds.js';
import {
  googleSignIn, googleSignOut, onAuthChange,
  loadCloudSave, saveCloudSave, applyBonusIfNeeded,
} from './firebase.js';
import { t, setLang, getLang, AVAILABLE_LANGS } from './i18n.js';

const TRAY_SIZE      = 4;
const HARD_EVERY     = 5;
const SCORE_PER_COIN = 1000;

// ── Layout ──────────────────────────────────────────────────────────────────

const LAYOUT = { NAV: 56, HEADER: 50, TRAY: 86, PAD: 14 };

function computeGridSize() {
  const { NAV, HEADER, TRAY, PAD } = LAYOUT;
  const aw = window.innerWidth  - PAD * 2;
  const ah = window.innerHeight - NAV - HEADER - TRAY - PAD * 2;
  return Math.max(160, Math.floor(Math.min(aw, ah) / 10) * 10);
}

function computeTraySize(gridSize) {
  return Math.max(52, Math.floor((Math.min(window.innerWidth - 24, gridSize) - 8 * 3) / 4));
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

const _el = id => document.getElementById(id);

function _setVisible(el, visible) {
  el?.classList.toggle('hidden', !visible);
}

// ── Global state ────────────────────────────────────────────────────────────

const economy = new EconomyStore();
const market  = new MarketStore();
let game      = null;

// ── Animation preference ──────────────────────────────────────────────────────
const ANIM_KEY       = 'weaverAnimations';
const _getAnimEnabled = () => localStorage.getItem(ANIM_KEY) !== 'false';
const _setAnimEnabled = v  => localStorage.setItem(ANIM_KEY, String(v));

// ── DOM refs ─────────────────────────────────────────────────────────────────

const startScreen  = _el('start-screen');
const mainApp      = _el('main-app');
const pagePlay     = _el('page-play');
const pageSkins    = _el('page-skins');
const pageMarket   = _el('page-market');
const pageSettings = _el('page-settings');
const overlayEl    = _el('gameover-overlay');
const toastEl      = _el('feedback-toast');
const buyRandomBtn = _el('buy-random-btn');
const skinsGrid    = _el('skins-grid');
const marketGrid   = _el('market-grid');
const powerupHint  = _el('powerup-hint');

// Reveal overlay elements
const _revealOverlay = _el('skin-reveal-overlay');
const _reelCanvas    = _el('skin-reveal-reel');
const _revealCanvas  = _el('skin-reveal-canvas');
const _revealName    = _el('skin-reveal-name');
const _revealTitle   = _el('skin-reveal-title');
const _revealResult  = _el('skin-reveal-result');
const _revealClose   = _el('skin-reveal-close');

// Apply i18n to static labels
function applyTranslations() {
  const set = (id, key) => { const el = _el(id); if (el) el.textContent = t(key); };
  set('start-btn',          'play');
  set('ss-signin-label',    'signIn');
  set('ss-bonus-badge',     'bonusBadge');
  set('restart-btn',        'playAgain');
  set('settings-lang-title','language');
  document.querySelectorAll('.nav-label').forEach((el, i) => {
    const key = ['market', 'menu', 'skins'][i];
    if (key) el.textContent = t(key);
  });
}
applyTranslations();

function _updateStartScreen() {
  _el('ss-best').textContent  = Number(localStorage.getItem('weaverBest') ?? 0).toLocaleString();
  _el('ss-coins').textContent = economy.coins;
}
_updateStartScreen();

// ── Navigation ───────────────────────────────────────────────────────────────

const PAGES = { play: pagePlay, skins: pageSkins, market: pageMarket, settings: pageSettings };

function showPage(name) {
  Object.entries(PAGES).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.page === name)
  );
  if (name === 'skins')    renderSkinsPage();
  if (name === 'market')   renderMarketPage();
  if (name === 'settings') renderSettingsPage();
}

document.querySelectorAll('.nav-btn').forEach(btn =>
  btn.addEventListener('click', () => showPage(btn.dataset.page))
);

// ── Menu button ───────────────────────────────────────────────────────────────

_el('nav-menu-btn').addEventListener('click', () => {
  _setVisible(mainApp, false);
  _setVisible(startScreen, true);
  _updateStartScreen();
});

// ── Start button ──────────────────────────────────────────────────────────────

_el('start-btn').addEventListener('click', () => {
  _setVisible(startScreen, false);
  _setVisible(mainApp, true);
  if (!game) game = new Game();
  showPage('play');
});

// ── Settings button ───────────────────────────────────────────────────────────

_el('ss-settings-btn').addEventListener('click', () => {
  _setVisible(startScreen, false);
  _setVisible(mainApp, true);
  if (!game) game = new Game();
  showPage('settings');
});

// ── Restart ───────────────────────────────────────────────────────────────────

_el('restart-btn').addEventListener('click', () => {
  overlayEl.classList.add('hidden');
  game.restart();
  showPage('play');
});

// ── Watch Ad (simulated) ──────────────────────────────────────────────────────

const AD_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes between ads
let _lastAdTime = -Infinity;
let _adCooldownInterval = null;

function _updateAdBtn() {
  const btn    = _el('ss-watch-ad-btn');
  const reward = btn?.querySelector('.earn-reward');
  if (!btn || !reward) return;
  const remaining = Math.ceil((AD_COOLDOWN_MS - (Date.now() - _lastAdTime)) / 1000);
  if (remaining > 0) {
    btn.disabled = true;
    const m = Math.floor(remaining / 60), s = remaining % 60;
    reward.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  } else {
    btn.disabled = false;
    reward.textContent = '+50 \uD83E\uDE99';
    clearInterval(_adCooldownInterval);
    _adCooldownInterval = null;
  }
}

_el('ss-watch-ad-btn').addEventListener('click', () => {
  if (_el('ss-watch-ad-btn').disabled) return;
  const btn   = _el('ss-watch-ad-btn');
  const label = btn.querySelector('.earn-label');
  const orig  = label.textContent;
  btn.disabled = true;
  btn.classList.add('watching');
  let secs = 5;
  label.textContent = `${secs}s...`;
  const iv = setInterval(() => {
    secs--;
    if (secs > 0) { label.textContent = `${secs}s...`; return; }
    clearInterval(iv);
    btn.classList.remove('watching');
    label.textContent = orig;
    _lastAdTime = Date.now();
    economy.addCoins(50);
    updateCoinDisplays();
    _updateStartScreen();
    showToast('+50 \uD83E\uDE99 Reklam \u00f6d\u00fcl\u00fc!');
    // Start countdown ticker visible on button
    _adCooldownInterval = setInterval(_updateAdBtn, 1000);
    _updateAdBtn();
  }, 1000);
});

// ── Buy Coins button → open market page ──────────────────────────────────────

_el('ss-buy-coins-btn').addEventListener('click', () => {
  _setVisible(startScreen, false);
  _setVisible(mainApp, true);
  if (!game) game = new Game();
  showPage('market');
});

// ── Auth ──────────────────────────────────────────────────────────────────────

let _currentUser = null;

// Strip size suffix from Google photo URLs and force =s96-c for consistent rendering
function _avatarUrl(url) {
  return url ? url.replace(/=s\d+(-c)?$/, '=s96-c') : '';
}

/** Sync all UI elements that reflect sign-in state. */
function _applyAuthUI(user) {
  _currentUser = user;
  const signedIn = !!user;

  // Start screen
  _setVisible(_el('ss-profile'),    signedIn);
  _setVisible(_el('ss-signin-btn'), !signedIn);
  if (signedIn) {
    _el('ss-avatar').src              = _avatarUrl(user.photoURL);
    _el('ss-username').textContent    = user.displayName || user.email;
  }

  // Settings panel
  const out = _el('settings-signed-out');
  const ind = _el('settings-signed-in');
  if (!out || !ind) return;
  _setVisible(out, !signedIn);
  _setVisible(ind,  signedIn);
  if (signedIn) {
    _el('settings-avatar').src              = _avatarUrl(user.photoURL);
    _el('settings-username').textContent    = user.displayName || '';
    _el('settings-email').textContent       = user.email || '';
  }
}

async function _handleSignIn() {
  if (!navigator.onLine) { showToast(t('noInternet')); return; }
  const btn      = _el('ss-signin-btn');
  const label    = _el('ss-signin-label');
  const origText = label?.textContent;
  try {
    if (btn)   btn.disabled    = true;
    if (label) label.textContent = '...';
    await googleSignIn();
  } catch (err) {
    const msg = err?.message ?? err?.code ?? String(err) ?? 'unknown';
    showToast('HATA:\n' + msg.substring(0, 200), { error: true });
  } finally {
    if (btn)   btn.disabled    = false;
    if (label) label.textContent = origText;
  }
}

async function _handleSignOut(e) {
  e?.preventDefault();
  e?.stopPropagation();
  try {
    await googleSignOut();
  } catch (err) {
    // Ignore sign-out errors — UI will update via onAuthStateChanged
  }
}

_el('ss-signin-btn').addEventListener('click', _handleSignIn);
_el('ss-signout-btn').addEventListener('click', _handleSignOut);

// Auth state listener
onAuthChange(async user => {
  _applyAuthUI(user);
  if (user) {
    // Load cloud save and merge (cloud wins on higher values)
    try {
      const cloud = await loadCloudSave(user.uid);
      if (cloud) {
        if ((cloud.coins ?? 0) > economy.coins) {
          economy.coins = cloud.coins;
          economy._save();
        }
        if (cloud.bestScore) {
          const local = Number(localStorage.getItem('weaverBest') ?? 0);
          if (cloud.bestScore > local) localStorage.setItem('weaverBest', cloud.bestScore);
        }
        if (cloud.unlockedIds) {
          cloud.unlockedIds.forEach(id => economy.unlockedIds.add(id));
          economy._save();
        }
        updateCoinDisplays();
      }
      // One-time welcome bonus — local flag prevents re-application on every sign-in
      const bonusKey = `weaverBonus_${user.uid}`;
      if (!localStorage.getItem(bonusKey)) {
        const bonus = await applyBonusIfNeeded(user.uid, user.email);
        if (bonus > 0) {
          localStorage.setItem(bonusKey, '1');
          economy.addCoins(bonus);
          updateCoinDisplays();
          showToast(t('welcome'));
        } else {
          // Firestore confirms bonus already given — cache locally
          localStorage.setItem(bonusKey, '1');
        }
      }
      // Save current state to cloud
      saveCloudSave(user.uid, _cloudSavePayload()).catch(() => {});
    } catch (e) {
      // cloud sync error — silent in production
    }
  }
});

// ── Cloud save payload ────────────────────────────────────────────────────────

function _cloudSavePayload() {
  return {
    coins:        economy.coins,
    unlockedIds:  [...economy.unlockedIds],
    activeSkinId: economy.activeSkinId,
    bestScore:    Number(localStorage.getItem('weaverBest') ?? 0),
  };
}

// ── Settings page ─────────────────────────────────────────────────────────────

function renderSettingsPage() {
  // Volume slider
  const slider = _el('sfx-volume-slider');
  const label  = _el('sfx-volume-val');
  const v = Math.round(getSfxVolume() * 100);
  slider.value      = v;
  label.textContent = `${v}%`;
  slider.oninput = () => {
    const pct = Number(slider.value);
    label.textContent = `${pct}%`;
    setSfxVolume(pct / 100);
  };

  // Language grid
  const langGrid = _el('settings-lang-grid');
  if (langGrid) {
    langGrid.innerHTML = '';
    for (const lang of AVAILABLE_LANGS) {
      const btn = document.createElement('button');
      btn.className = 'lang-btn' + (getLang() === lang.code ? ' lang-btn--active' : '');
      btn.textContent = lang.label;
      btn.addEventListener('click', () => {
        setLang(lang.code);
        applyTranslations();
        renderSettingsPage();
      });
      langGrid.appendChild(btn);
    }
  }

  // Settings sign-in/sign-out buttons
  const siBtn = _el('settings-signin-btn');
  const soBtn = _el('settings-signout-btn');
  if (siBtn) siBtn.onclick = _handleSignIn;
  if (soBtn) soBtn.onclick = _handleSignOut;

  // Animation toggle
  const animToggle = _el('anim-toggle');
  if (animToggle) {
    animToggle.checked  = _getAnimEnabled();
    animToggle.onchange = () => _setAnimEnabled(animToggle.checked);
  }

  _applyAuthUI(_currentUser);
}



// ── Skin reveal slot-machine animation ───────────────────────────────────────

const REVEAL_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#fb923c'];

function _animateBuyReveal(wonSkin) {
  return new Promise(resolve => {
    _setVisible(_revealOverlay, true);
    _revealResult.classList.add('hidden');
    _revealTitle.textContent = '🎰 Çark Dönüyor...';

    const ctx = _reelCanvas.getContext('2d');
    const W   = _reelCanvas.width;   // 260
    const H   = _reelCanvas.height;  // 90
    const sz  = H - 14;              // cell size ≈ 76

    // Spin schedule: fast → medium → slow → stop
    const FAST_STEPS = 18;   // 60ms each  → 1080ms
    const MID_STEPS  = 8;    // 120ms each → 960ms
    const SLOW_STEPS = 6;    // 155…330ms  → ~1350ms

    const TOTAL = FAST_STEPS + MID_STEPS + SLOW_STEPS;

    // Pre-build spin sequence; guarantee it ends on wonSkin
    const seq = [];
    for (let i = 0; i < TOTAL - 1; i++)
      seq.push(SKINS[Math.floor(Math.random() * SKINS.length)]);
    seq.push(wonSkin);

    let step = 0;

    function drawStep(i) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0d0d1e';
      ctx.fillRect(0, 0, W, H);

      // Draw 3 cells: left (dim), center (bright), right (dim)
      for (let off = -1; off <= 1; off++) {
        const si   = Math.max(0, Math.min(seq.length - 1, i + off));
        const skin = seq[si];
        const cx   = W / 2 + off * (sz + 10) - sz / 2;
        const cy   = (H - sz) / 2;
        ctx.globalAlpha = off === 0 ? 1 : 0.3;
        skin.drawCell(ctx, cx, cy, sz, REVEAL_COLORS[si % REVEAL_COLORS.length], 10);
      }
      ctx.globalAlpha = 1;

      // Highlight box around center cell
      const cx = W / 2 - sz / 2;
      const cy = (H - sz) / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(200,160,255,0.8)';
      ctx.lineWidth   = 2.5;
      ctx.shadowColor = '#a78bfa';
      ctx.shadowBlur  = 10;
      ctx.strokeRect(cx - 2, cy - 2, sz + 4, sz + 4);
      ctx.restore();
    }

    function nextStep() {
      drawStep(step);
      step++;

      if (step > TOTAL) {
        // Spinning done — show the result panel
        setTimeout(() => {
          _revealTitle.textContent = '🎉 Yeni Skin!';
          _revealResult.classList.remove('hidden');
          const rc = _revealCanvas.getContext('2d');
          rc.fillStyle = '#13132a';
          rc.fillRect(0, 0, 90, 90);
          wonSkin.drawCell(rc, 4, 4, 82, '#a78bfa', 12);
          _revealName.textContent = wonSkin.name;
        }, 150);
        return;
      }

      let delay;
      if (step <= FAST_STEPS) {
        delay = 60;
      } else if (step <= FAST_STEPS + MID_STEPS) {
        delay = 120;
      } else {
        const p = step - FAST_STEPS - MID_STEPS; // 1..SLOW_STEPS
        delay = 120 + p * 35;                     // 155, 190, 225, 260, 295, 330
      }
      setTimeout(nextStep, delay);
    }

    nextStep();

    _revealClose.onclick = () => {
      _setVisible(_revealOverlay, false);
      resolve();
    };
  });
}

buyRandomBtn.addEventListener('click', async () => {
  const result = economy.buyRandom();
  if (result.type === 'noCoins')       showToast(t('needCoins'));
  else if (result.type === 'allOwned') showToast(t('allOwned'));
  else {
    updateCoinDisplays();
    if (_getAnimEnabled()) {
      await _animateBuyReveal(result.skin);
    } else {
      showToast(`${t('got')} ${result.skin.name}!`);
    }
    renderSkinsPage();
    if (game) { game.renderer.setSkin(result.skin); game._renderTray(); }
  }
});

// ── Skins page ───────────────────────────────────────────────────────────────

const PREVIEW_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#f59e0b'];

function _makeSkinPreview(skin) {
  const cvs = document.createElement('canvas');
  cvs.width = 84; cvs.height = 84;
  cvs.className = 'skin-preview-canvas';
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#13132a'; ctx.fillRect(0, 0, 84, 84);
  const cs = 30, gap = 4, ox = 4, oy = 4;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      skin.drawCell(ctx, ox + c * (cs + gap), oy + r * (cs + gap), cs, PREVIEW_COLORS[r * 2 + c], 4);
  return cvs;
}

function _makeSkinCard(skin) {
  const owned    = economy.unlockedIds.has(skin.id);
  const isActive = economy.activeSkinId === skin.id;

  const card = document.createElement('div');
  const cardClass = isActive ? 'skin-card active-card' : owned ? 'skin-card owned-card' : 'skin-card locked';
  card.className = cardClass;

  const badge = document.createElement('span');
  badge.className = 'skin-badge ' + (isActive ? 'activeb' : owned ? 'owned' : 'price');
  badge.textContent = isActive ? 'ACTIVE' : owned ? 'OWNED' : `${skin.price}\uD83E\uDE99`;

  const name = document.createElement('span');
  name.className = 'skin-name'; name.textContent = skin.name;
  const desc = document.createElement('span');
  desc.className = 'skin-desc'; desc.textContent = skin.desc;

  card.append(_makeSkinPreview(skin), badge, name, desc);

  if (owned && !isActive) {
    card.addEventListener('click', () => {
      economy.setActive(skin.id);
      if (game) {
        game.renderer.setSkin(skin);
        game._renderTray();
        if (isGameOver(game.tray.filter(Boolean), game.grid))
          setTimeout(() => game._gameOver(), 400);
      }
      renderSkinsPage();
    });
  }
  return card;
}

function renderSkinsPage() {
  _el('skins-coin-display').textContent = economy.coins;
  const locked = SKINS.filter(s => s.price > 0 && !economy.unlockedIds.has(s.id));
  buyRandomBtn.disabled = locked.length === 0 || economy.coins < 100;
  skinsGrid.innerHTML = '';
  SKINS.forEach(skin => skinsGrid.appendChild(_makeSkinCard(skin)));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function updateCoinDisplays() {
  const c = economy.coins;
  ['coin-display', 'skins-coin-display', 'market-coin-display'].forEach(id => {
    const el = _el(id); if (el) el.textContent = c;
  });
}

let _toastTimer = null;
function showToast(msg, { error = false } = {}) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('toast--error', error);
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastEl.classList.remove('toast--error');
  }, error ? 4000 : 1500);
}

// ── Market page ───────────────────────────────────────────────────────────────

function _makeMarketItem(pu) {
  const item = document.createElement('div');
  item.className = 'market-item';

  const icon = document.createElement('div');
  icon.className = 'market-item-icon'; icon.textContent = pu.icon;

  const info = document.createElement('div');
  info.className = 'market-item-info';
  info.innerHTML = `<div class="market-item-name">${pu.name}</div><div class="market-item-desc">${pu.desc}</div>`;

  const cnt = document.createElement('span');
  cnt.className = 'market-count';
  cnt.textContent = `x${market.count(pu.id)}`;

  const buyBtn = document.createElement('button');
  buyBtn.className = 'market-buy-btn';
  buyBtn.textContent = `${pu.price} 🪙`;
  buyBtn.disabled = economy.coins < pu.price;
  buyBtn.addEventListener('click', () => {
    const r = market.buy(pu.id, economy);
    if (r.type === 'noCoins') { showToast(t('needMoreCoins')); return; }
    updateCoinDisplays();
    renderMarketPage();
    showToast(`${t('got')} ${pu.name}!`);
  });

  const useBtn = document.createElement('button');
  useBtn.className = 'market-use-btn';
  useBtn.textContent = 'USE';
  useBtn.disabled = market.count(pu.id) === 0 || !game;
  useBtn.addEventListener('click', () => {
    if (!game) { showToast(t('noGame')); return; }
    game.activatePowerup(pu.id);
    showPage('play');
  });

  const actions = document.createElement('div');
  actions.className = 'market-item-actions';
  actions.append(cnt, buyBtn, useBtn);
  item.append(icon, info, actions);
  return item;
}

function renderMarketPage() {
  _el('market-coin-display').textContent = economy.coins;
  marketGrid.innerHTML = '';
  POWERUPS.forEach(pu => marketGrid.appendChild(_makeMarketItem(pu)));
  _renderCoinPacks();
}

// ── Coin packs ────────────────────────────────────────────────────────────────

const COIN_PACKS = [
  { id: 'pack_sm',  coins: 200,  price: '₺9,99',  icon: '🪙',  label: '200 Altın' },
  { id: 'pack_md',  coins: 600,  price: '₺24,99', icon: '💰',  label: '600 Altın', best: true },
  { id: 'pack_lg',  coins: 1500, price: '₺49,99', icon: '💎',  label: '1500 Altın' },
];

function _makeCoinPack(pack) {
  const el = document.createElement('div');
  el.className = 'coin-pack' + (pack.best ? ' best-value' : '');
  el.innerHTML = `
    <span class="coin-pack-icon">${pack.icon}</span>
    <span class="coin-pack-coins">${pack.label}</span>
    <span class="coin-pack-price">${pack.price}</span>
    ${pack.best ? '<span class="coin-pack-badge">EN İYİ</span>' : ''}
  `;
  el.addEventListener('click', () => {
    // Simulate IAP — award coins instantly (placeholder until payment SDK integrated)
    economy.addCoins(pack.coins);
    updateCoinDisplays();
    _updateStartScreen();
    renderMarketPage();
    showToast(`+${pack.coins} 🪙 Teşekkürler!`);
  });
  return el;
}

function _renderCoinPacks() {
  const grid = _el('coin-packs-grid');
  if (!grid) return;
  grid.innerHTML = '';
  COIN_PACKS.forEach(pack => grid.appendChild(_makeCoinPack(pack)));
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Game                                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

class Game {
  constructor() {
    this.grid        = new Grid();
    this.scoreSystem = new ScoreSystem();
    this.particles   = new ParticleSystem();

    // Size canvases to fit screen
    const size   = computeGridSize();
    const prevSz = computeTraySize(size);
    const gridCanvas = _el('grid-canvas');
    const fxCanvas   = _el('fx-canvas');
    gridCanvas.width  = gridCanvas.height = size;
    fxCanvas.width    = fxCanvas.height   = size;
    document.querySelectorAll('.block-preview').forEach(el => {
      el.width = el.height = prevSz;
    });

    this.renderer = new Renderer(this.grid, gridCanvas, fxCanvas);
    this.renderer.setSkin(economy.getActiveSkin());
    this._syncCellMetrics();

    this.tray       = [];
    this.usedMask   = [];
    this.placements = 0;
    this._coinMilestone    = 0;
    this._coinsAtGameStart = economy.coins;

    // UI refs
    this.scoreEl = _el('score-display');
    this.bestEl  = _el('best-display');
    this.comboEl = _el('combo-display');

    // Wire observers
    this.grid.onChange(cells => this.renderer.redrawCells(cells));

    this.scoreSystem.onChange(ss => {
      this.scoreEl.textContent = ss.score.toLocaleString();
      this.bestEl.textContent  = ss.best.toLocaleString();
      this.comboEl.textContent = `x${ss.comboMultiplier}`;
      this._checkCoins(ss.score);
    });

    this.renderer.onDrop = (block, el, row, col) => this._handleDrop(block, el, row, col);
    this.renderer.setBlockProvider(idx => this.tray[idx] ?? null);

    // Handle orientation / resize
    window.addEventListener('resize', () => this._handleResize());

    this._dealTray();
    this._loop(performance.now());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _syncCellMetrics() {
    this.particles.cellMetrics = {
      cell:    this.renderer.CELL,
      gap:     this.renderer.GAP,
      padding: this.renderer.PADDING,
    };
  }

  _buildSnap(extraPositions = []) {
    const snap = {};
    for (let r = 0; r < Grid.SIZE; r++)
      for (let c = 0; c < Grid.SIZE; c++) {
        const cell = this.grid.get(r, c);
        if (!cell.isEmpty) snap[`${r},${c}`] = cell.colorID;
      }
    for (const { row: r, col: c, colorID } of extraPositions)
      snap[`${r},${c}`] = colorID;
    return snap;
  }

  // ── Coin earning ──────────────────────────────────────────────────────────

  _checkCoins(score) {
    const milestone = Math.floor(score / SCORE_PER_COIN);
    const earned    = milestone - this._coinMilestone;
    if (earned > 0) {
      this._coinMilestone = milestone;
      economy.addCoins(earned);
      updateCoinDisplays();
      showToast(`+${earned} \uD83E\uDE99`);
    }
  }

  // ── Tray ───────────────────────────────────────────────────────────────────

  _dealTray() {
    const hard   = this.placements > 0 && this.placements % HARD_EVERY === 0;
    this.tray     = generateTray(this.grid, TRAY_SIZE, hard);
    this.usedMask = new Array(TRAY_SIZE).fill(false);
    this._renderTray();
    if (isGameOver(this.tray.filter(Boolean), this.grid))
      setTimeout(() => this._gameOver(), 400);
  }

  _renderTray() {
    const tray = _el('tray');
    while (tray.children.length < this.tray.length) {
      const idx = tray.children.length;
      const el = document.createElement('canvas');
      el.id = `block${idx}`; el.className = 'block-preview'; el.dataset.idx = idx;
      const sz = tray.children[0]?.width ?? 64;
      el.width = el.height = sz;
      tray.appendChild(el);
      this.renderer.rebindDrag();
    }
    for (let i = 0; i < this.tray.length; i++) {
      const el = _el(`block${i}`);
      if (!el) continue;
      el.classList.remove('used', 'dragging');
      this.renderer.drawBlockPreview(el, this.tray[i]);
    }
  }

  _markUsed(idx) {
    this.usedMask[idx] = true;
    _el(`block${idx}`).classList.add('used');
    this.tray[idx] = null;
    if (this.tray.every(b => b === null)) setTimeout(() => this._dealTray(), 300);
  }

  // ── Drop ───────────────────────────────────────────────────────────────────

  _handleDrop(block, el, row, col) {
    const positions = block.getAbsolutePositions(row, col);
    if (!this.grid.canPlace(positions)) return;

    // Snapshot colors before placement (for particles)
    const snap = this._buildSnap();

    this.grid.fillMany(positions, block.colorID, block.id);
    for (const { row: r, col: c } of positions) snap[`${r},${c}`] = block.colorID;
    this.placements++;
    playPlace();

    const idx = this.tray.findIndex(b => b?.id === block.id);
    if (idx !== -1) this._markUsed(idx);

    const result = runClearingLogic(this.grid, positions);
    if (result.totalCleared > 0) {
      this.particles.burstCells(result.cleared, PALETTE, snap);
      const { delta, label } = this.scoreSystem.record({
        deletedBlocks: result.totalCleared,
        clearedRows:   result.clearedRows.length,
        clearedCols:   result.clearedCols.length,
        colorClusters: result.colorClusters.length,
        now:           performance.now(),
      });
      this.particles.spawnScoreFloat(result.cleared, delta, label, PALETTE, snap);
      // pick sound based on how impressive the clear is
      const hasMega = result.clearedRows.length > 0 && result.clearedCols.length > 0 && result.colorClusters.length > 0;
      if (hasMega)                             playMega();
      else if (result.colorClusters.length)    playCluster();
      else                                     playClear();
    }

    if (this.tray.filter(Boolean).length > 0 && isGameOver(this.tray.filter(Boolean), this.grid))
      setTimeout(() => this._gameOver(), 400);
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  _loop(last) {
    const now = performance.now();
    const dt  = Math.min((now - last) / 1000, 0.05);
    this.renderer.tickTweens(dt);
    // Clear fxCtx each frame, then redraw particles + ghost
    this.renderer.fxCtx.clearRect(0, 0, this.renderer.fxCanvas.width, this.renderer.fxCanvas.height);
    if (this.particles.hasParticles) {
      this.particles.tick(dt, this.renderer.fxCtx);
    }
    this.renderer.redrawGhost();
    requestAnimationFrame(t => this._loop(t));
  }

  // ── Game over ──────────────────────────────────────────────────────────────

  _gameOver() {
    const earned = economy.coins - this._coinsAtGameStart;
    _el('final-score').textContent = this.scoreSystem.score.toLocaleString();
    _el('final-coins').textContent = `+${earned} \uD83E\uDE99`;
    overlayEl.classList.remove('hidden');
    // Auto-save progress to cloud
    if (_currentUser) saveCloudSave(_currentUser.uid, _cloudSavePayload()).catch(() => {});
  }

  // ── Restart ────────────────────────────────────────────────────────────────

  restart() {
    this.grid.reset();
    this.scoreSystem.reset();
    this.particles._particles = [];
    this.placements      = 0;
    this._coinMilestone  = 0;
    this._coinsAtGameStart = economy.coins;
    this.renderer.setSkin(economy.getActiveSkin());
    this._dealTray();
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  _handleResize() {
    const size   = computeGridSize();
    const prevSz = computeTraySize(size);
    const gc = _el('grid-canvas');
    const fc = _el('fx-canvas');
    if (gc.width === size) return;
    gc.width = gc.height = size;
    fc.width = fc.height = size;
    document.querySelectorAll('.block-preview').forEach(el => {
      el.width = el.height = prevSz;
    });
    this.renderer.resize();
    this._syncCellMetrics();
    this._renderTray();
  }

  // ── Power-ups ──────────────────────────────────────────────────────────────

  activatePowerup(id) {
    if (!market.use(id)) { showToast('No power-up left!'); return; }
    updateCoinDisplays();

    if (id === 'color_bomb') {
      // No targeting needed — find most frequent color and clear it
      const counts = Array(9).fill(0);
      for (let r = 0; r < Grid.SIZE; r++)
        for (let c = 0; c < Grid.SIZE; c++) {
          const cell = this.grid.get(r, c);
          if (!cell.isEmpty) counts[cell.colorID]++;
        }
      const topColor = counts.reduce((best, cnt, idx) => cnt > counts[best] ? idx : best, 1);
      const positions = [];
      for (let r = 0; r < Grid.SIZE; r++)
        for (let c = 0; c < Grid.SIZE; c++) {
          const cell = this.grid.get(r, c);
          if (!cell.isEmpty && cell.colorID === topColor) positions.push({ row: r, col: c });
        }
      this._executeClear(positions, 'Color Bomb! 🌈');
      return;
    }

    if (id === 'extra_block') {
      // Add one newly-generated block to the tray
      import('./blocks.js').then(({ generateTray: gen }) => {
        const extra = gen(this.grid, 1, false);
        this.tray.push(extra[0]);
        this.usedMask.push(false);
        this._renderTray();
        showToast('Extra block added! ➕');
      });
      return;
    }

    // Targeted power-ups: wait for user to tap a cell
    this._pendingPowerup = id;
    powerupHint.textContent = id === 'smash'
      ? '💥 Tap a filled cell to smash it'
      : id === 'blast_right'
      ? '➡️ Tap a cell to blast right'
      : '⬅️ Tap a cell to blast left';
    powerupHint.classList.remove('hidden');
    _el('game-container').classList.add('powerup-target');

    const onTap = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pt = e.touches ? e.touches[0] : e;
      const { row, col } = this.renderer._screenToGrid(pt.clientX, pt.clientY);
      if (row < 0) return;

      powerupHint.classList.add('hidden');
      _el('game-container').classList.remove('powerup-target');
      _el('fx-canvas').removeEventListener('pointerdown', onTap);
      _el('fx-canvas').removeEventListener('touchstart', onTap);

      this._applyTargetedPowerup(this._pendingPowerup, row, col);
      this._pendingPowerup = null;
    };

    const fxEl = _el('fx-canvas');
    fxEl.addEventListener('pointerdown', onTap, { once: true });
    fxEl.addEventListener('touchstart',  onTap, { once: true, passive: false });
  }

  _applyTargetedPowerup(id, row, col) {
    if (id === 'smash') {
      const cell = this.grid.get(row, col);
      if (!cell || cell.isEmpty) { showToast('Pick a filled cell!'); return; }
      this._executeClear([{ row, col }], 'Smashed! 💥');
    } else if (id === 'blast_right') {
      const positions = [];
      for (let c = col; c < Grid.SIZE; c++) {
        if (!this.grid.get(row, c).isEmpty) positions.push({ row, col: c });
      }
      if (!positions.length) { showToast('Nothing to blast!'); return; }
      this._executeClear(positions, 'Right Blast! ➡️');
    } else if (id === 'blast_left') {
      const positions = [];
      for (let c = col; c >= 0; c--) {
        if (!this.grid.get(row, c).isEmpty) positions.push({ row, col: c });
      }
      if (!positions.length) { showToast('Nothing to blast!'); return; }
      this._executeClear(positions, 'Left Blast! ⬅️');
    }
  }

  _executeClear(positions, label) {
    if (!positions.length) return;
    const snap = this._buildSnap();
    this.grid.clearMany(positions);
    this.particles.burstCells(positions, PALETTE, snap);
    const { delta } = this.scoreSystem.record({
      deletedBlocks: positions.length,
      clearedRows: [], clearedCols: [], colorClusters: [],
      now: performance.now(),
    });
    this.particles.spawnScoreFloat(positions, delta, label, PALETTE, snap);
    playCluster();
    updateCoinDisplays();
  }
}
