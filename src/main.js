/**
 * main.js - Game orchestrator with start menu, economy, skins, and bottom nav.
 */

import { Grid }              from './grid.js';
import { generateTray }      from './blocks.js';
import { COLORS as PALETTE } from './blocks.js';
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

const TRAY_SIZE  = 4;
const HARD_EVERY = 5;
const SCORE_PER_COIN = 1000;

// ── Layout helpers ──────────────────────────────────────────────────────────

function computeGridSize() {
  const NAV = 56, HEADER = 50, TRAY = 86, PAD = 14;
  const aw = window.innerWidth  - PAD * 2;
  const ah = window.innerHeight - NAV - HEADER - TRAY - PAD * 2;
  return Math.max(160, Math.floor(Math.min(aw, ah) / 10) * 10);
}

function computeTraySize(gridSize) {
  const aw = Math.min(window.innerWidth - 24, gridSize);
  return Math.max(52, Math.floor((aw - 8*3) / 4));
}

// ── Global state ────────────────────────────────────────────────────────────

const economy = new EconomyStore();
const market  = new MarketStore();
let game      = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const startScreen  = document.getElementById('start-screen');
const mainApp      = document.getElementById('main-app');
const pagePlay     = document.getElementById('page-play');
const pageSkins    = document.getElementById('page-skins');
const pageMarket   = document.getElementById('page-market');
const pageSettings = document.getElementById('page-settings');
const overlayEl    = document.getElementById('gameover-overlay');
const toastEl      = document.getElementById('feedback-toast');
const buyRandomBtn = document.getElementById('buy-random-btn');
const skinsGrid    = document.getElementById('skins-grid');
const marketGrid   = document.getElementById('market-grid');
const powerupHint  = document.getElementById('powerup-hint');

// Apply i18n to static labels
function applyTranslations() {
  document.getElementById('ss-best').closest('.ss-box')?.querySelector('.ss-label')?.setAttributeNS(null, 'data-i18n', 'best');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById('start-btn').textContent         = t('play');
  document.getElementById('ss-signin-label').textContent   = t('signIn');
  document.getElementById('ss-bonus-badge').textContent    = t('bonusBadge');
  const navLabels = document.querySelectorAll('.nav-label');
  const navKeys   = ['market', 'menu', 'skins'];
  navLabels.forEach((el, i) => { if (navKeys[i]) el.textContent = t(navKeys[i]); });
  document.getElementById('restart-btn').textContent = t('playAgain');
  document.getElementById('settings-lang-title').textContent = t('language');
}
applyTranslations();

// Update start screen
document.getElementById('ss-best').textContent  = Number(localStorage.getItem('weaverBest') ?? 0).toLocaleString();
document.getElementById('ss-coins').textContent = economy.coins;

// ── Navigation ───────────────────────────────────────────────────────────────

function showPage(name) {
  pagePlay.classList.toggle('hidden',     name !== 'play');
  pageSkins.classList.toggle('hidden',    name !== 'skins');
  pageMarket.classList.toggle('hidden',   name !== 'market');
  pageSettings.classList.toggle('hidden', name !== 'settings');
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

// ── Menu button (center nav) ──────────────────────────────────────────────────

document.getElementById('nav-menu-btn').addEventListener('click', () => {
  mainApp.classList.add('hidden');
  startScreen.classList.remove('hidden');
  document.getElementById('ss-best').textContent  = Number(localStorage.getItem('weaverBest') ?? 0).toLocaleString();
  document.getElementById('ss-coins').textContent = economy.coins;
});

// ── Start button ─────────────────────────────────────────────────────────────

document.getElementById('start-btn').addEventListener('click', () => {
  startScreen.classList.add('hidden');
  mainApp.classList.remove('hidden');
  if (!game) game = new Game();
  showPage('play');
});

// ── Restart ──────────────────────────────────────────────────────────────────

document.getElementById('restart-btn').addEventListener('click', () => {
  overlayEl.classList.add('hidden');
  game.restart();
  showPage('play');
});

// ── Auth ──────────────────────────────────────────────────────────────────────

let _currentUser = null;

/** Sync UI elements that reflect sign-in state. */
function _applyAuthUI(user) {
  _currentUser = user;

  // Start screen profile row
  const ssProfile  = document.getElementById('ss-profile');
  const ssAvatar   = document.getElementById('ss-avatar');
  const ssUsername = document.getElementById('ss-username');
  const ssSignin   = document.getElementById('ss-signin-btn');
  if (user) {
    ssAvatar.src     = user.photoURL || '';
    ssUsername.textContent = user.displayName || user.email;
    ssProfile.classList.remove('hidden');
    ssSignin.classList.add('hidden');
  } else {
    ssProfile.classList.add('hidden');
    ssSignin.classList.remove('hidden');
  }

  // Settings page (if currently shown)
  _refreshSettingsAuth(user);
}

function _refreshSettingsAuth(user) {
  const out = document.getElementById('settings-signed-out');
  const ind = document.getElementById('settings-signed-in');
  if (!out || !ind) return;
  if (user) {
    document.getElementById('settings-avatar').src = user.photoURL || '';
    document.getElementById('settings-username').textContent = user.displayName || '';
    document.getElementById('settings-email').textContent    = user.email || '';
    out.classList.add('hidden');
    ind.classList.remove('hidden');
  } else {
    out.classList.remove('hidden');
    ind.classList.add('hidden');
  }
}

async function _handleSignIn() {
  try {
    showToast(t('signingIn'));
    await googleSignIn();
    // onAuthStateChanged fires automatically after native sign-in
  } catch (err) {
    showToast(t('signInFailed') + ': ' + (err.code ?? err.message ?? 'error'));
  }
}

async function _handleSignOut() {
  await googleSignOut();
}

// Sign-in buttons (start screen + settings page)
document.getElementById('ss-signin-btn').addEventListener('click', _handleSignIn);

// Sign-out on start screen profile
document.getElementById('ss-signout-btn').addEventListener('click', _handleSignOut);

// Settings button on start screen
document.getElementById('ss-settings-btn').addEventListener('click', () => {
  mainApp.classList.remove('hidden');
  startScreen.classList.add('hidden');
  if (!game) game = new Game();
  showPage('settings');
});

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
      // One-time welcome bonus
      const bonus = await applyBonusIfNeeded(user.uid, user.email);
      if (bonus > 0) {
        economy.addCoins(bonus);
        updateCoinDisplays();
        showToast(t('welcome'));
      }
      // Save current state to cloud
      saveCloudSave(user.uid, {
        coins:        economy.coins,
        unlockedIds:  [...economy.unlockedIds],
        activeSkinId: economy.activeSkinId,
        bestScore:    Number(localStorage.getItem('weaverBest') ?? 0),
      }).catch(() => {});
    } catch (e) {
      console.warn('Cloud sync error:', e);
    }
  }
});

// ── Settings page ─────────────────────────────────────────────────────────────

function renderSettingsPage() {
  // Volume slider
  const slider = document.getElementById('sfx-volume-slider');
  const label  = document.getElementById('sfx-volume-val');
  const v = Math.round(getSfxVolume() * 100);
  slider.value      = v;
  label.textContent = `${v}%`;
  slider.oninput = () => {
    const pct = Number(slider.value);
    label.textContent = `${pct}%`;
    setSfxVolume(pct / 100);
  };

  // Language grid
  const langGrid = document.getElementById('settings-lang-grid');
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
  const siBtn = document.getElementById('settings-signin-btn');
  const soBtn = document.getElementById('settings-signout-btn');
  if (siBtn) siBtn.onclick = _handleSignIn;
  if (soBtn) soBtn.onclick = _handleSignOut;

  _refreshSettingsAuth(_currentUser);
}



buyRandomBtn.addEventListener('click', () => {
  const result = economy.buyRandom();
  if (result.type === 'noCoins')       showToast(t('needCoins'));
  else if (result.type === 'allOwned') showToast(t('allOwned'));
  else {
    showToast(`${t('got')} ${result.skin.name}!`);
    updateCoinDisplays();
    renderSkinsPage();
    if (game) { game.renderer.setSkin(result.skin); game._renderTray(); }
  }
});

// ── Skins page ───────────────────────────────────────────────────────────────

function renderSkinsPage() {
  document.getElementById('skins-coin-display').textContent = economy.coins;
  const locked = SKINS.filter(s => s.price > 0 && !economy.unlockedIds.has(s.id));
  buyRandomBtn.disabled = locked.length === 0 || economy.coins < 100;

  skinsGrid.innerHTML = '';
  for (const skin of SKINS) {
    const owned    = economy.unlockedIds.has(skin.id);
    const isActive = economy.activeSkinId === skin.id;

    const card = document.createElement('div');
    card.className = 'skin-card' + (isActive ? ' active-card' : '') + (!owned ? ' locked' : '');

    // 2x2 preview canvas
    const pEl = document.createElement('canvas');
    pEl.width = 84; pEl.height = 84;
    pEl.className = 'skin-preview-canvas';
    const ctx = pEl.getContext('2d');
    ctx.fillStyle = '#13132a'; ctx.fillRect(0,0,84,84);
    const cs = 30, gap = 4, ox = 5, oy = 5;
    const cols = ['#a78bfa','#60a5fa','#34d399','#f59e0b'];
    for (let r=0; r<2; r++) for (let c=0; c<2; c++)
      skin.drawCell(ctx, ox+c*(cs+gap), oy+r*(cs+gap), cs, cols[r*2+c], 4);

    const badge = document.createElement('span');
    badge.className = 'skin-badge ' + (isActive ? 'activeb' : owned ? 'owned' : 'price');
    badge.textContent = isActive ? 'ACTIVE' : owned ? 'OWNED' : `${skin.price}\uD83E\uDE99`;

    const name = document.createElement('span');
    name.className = 'skin-name'; name.textContent = skin.name;
    const desc = document.createElement('span');
    desc.className = 'skin-desc'; desc.textContent = skin.desc;

    card.append(pEl, badge, name, desc);

    if (owned && !isActive) {
      card.addEventListener('click', () => {
        economy.setActive(skin.id);
        if (game) { game.renderer.setSkin(skin); game._renderTray(); }
        renderSkinsPage();
      });
    }
    skinsGrid.appendChild(card);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function updateCoinDisplays() {
  const c = economy.coins;
  const eC = document.getElementById('coin-display');
  const eS = document.getElementById('skins-coin-display');
  const eM = document.getElementById('market-coin-display');
  if (eC) eC.textContent = c;
  if (eS) eS.textContent = c;
  if (eM) eM.textContent = c;
}

let _toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

// ── Market page ───────────────────────────────────────────────────────────────

function renderMarketPage() {
  document.getElementById('market-coin-display').textContent = economy.coins;
  marketGrid.innerHTML = '';
  for (const pu of POWERUPS) {
    const item = document.createElement('div');
    item.className = 'market-item';

    const icon = document.createElement('div');
    icon.className = 'market-item-icon'; icon.textContent = pu.icon;

    const info = document.createElement('div');
    info.className = 'market-item-info';
    info.innerHTML = `<div class="market-item-name">${pu.name}</div><div class="market-item-desc">${pu.desc}</div>`;

    const actions = document.createElement('div');
    actions.className = 'market-item-actions';

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

    actions.append(cnt, buyBtn, useBtn);
    item.append(icon, info, actions);
    marketGrid.appendChild(item);
  }
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
    const gridCanvas = document.getElementById('grid-canvas');
    const fxCanvas   = document.getElementById('fx-canvas');
    gridCanvas.width  = gridCanvas.height = size;
    fxCanvas.width    = fxCanvas.height   = size;
    document.querySelectorAll('.block-preview').forEach(el => {
      el.width = el.height = prevSz;
    });

    this.renderer = new Renderer(this.grid, gridCanvas, fxCanvas);
    this.renderer.setSkin(economy.getActiveSkin());
    // Give particles the correct cell dimensions after renderer is sized
    this.particles.cellMetrics = {
      cell:    this.renderer.CELL,
      gap:     this.renderer.GAP,
      padding: this.renderer.PADDING,
    };

    this.tray       = [];
    this.usedMask   = [];
    this.placements = 0;
    this._coinMilestone    = 0;
    this._coinsAtGameStart = economy.coins;

    // UI refs
    this.scoreEl = document.getElementById('score-display');
    this.bestEl  = document.getElementById('best-display');
    this.comboEl = document.getElementById('combo-display');

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

  // ── Coin earning ───────────────────────────────────────────────────────────

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
  }

  _renderTray() {
    // Ensure enough preview canvases exist (extra_block may grow tray beyond TRAY_SIZE)
    const tray = document.getElementById('tray');
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
      const el = document.getElementById(`block${i}`);
      if (!el) continue;
      el.classList.remove('used', 'dragging');
      this.renderer.drawBlockPreview(el, this.tray[i]);
    }
  }

  _markUsed(idx) {
    this.usedMask[idx] = true;
    document.getElementById(`block${idx}`).classList.add('used');
    this.tray[idx] = null;
    if (this.tray.every(b => b === null)) setTimeout(() => this._dealTray(), 300);
  }

  // ── Drop ───────────────────────────────────────────────────────────────────

  _handleDrop(block, el, row, col) {
    const positions = block.getAbsolutePositions(row, col);
    if (!this.grid.canPlace(positions)) return;

    // Snapshot colors before placement (for particles)
    const snap = {};
    for (let r = 0; r < Grid.SIZE; r++)
      for (let c = 0; c < Grid.SIZE; c++) {
        const cell = this.grid.get(r, c);
        if (!cell.isEmpty) snap[`${r},${c}`] = cell.colorID;
      }

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
      if (label) showToast(label);
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
    // Always clear fxCtx each frame: removes ghost after drag ends,
    // and gives particles a clean canvas to draw on.
    this.renderer.fxCtx.clearRect(0, 0, this.renderer.fxCanvas.width, this.renderer.fxCanvas.height);
    if (this.particles.hasParticles) {
      this.particles.tick(dt, this.renderer.fxCtx);
    }
    requestAnimationFrame(t => this._loop(t));
  }

  // ── Game over ──────────────────────────────────────────────────────────────

  _gameOver() {
    const earned = economy.coins - this._coinsAtGameStart;
    document.getElementById('final-score').textContent = this.scoreSystem.score.toLocaleString();
    document.getElementById('final-coins').textContent = `+${earned} \uD83E\uDE99`;
    overlayEl.classList.remove('hidden');
    // Auto-save progress to cloud
    if (_currentUser) {
      saveCloudSave(_currentUser.uid, {
        coins:        economy.coins,
        unlockedIds:  [...economy.unlockedIds],
        activeSkinId: economy.activeSkinId,
        bestScore:    Number(localStorage.getItem('weaverBest') ?? 0),
      }).catch(() => {});
    }
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
    const gc     = document.getElementById('grid-canvas');
    const fc     = document.getElementById('fx-canvas');
    if (gc.width === size) return;
    gc.width = gc.height = size;
    fc.width = fc.height = size;
    document.querySelectorAll('.block-preview').forEach(el => {
      el.width = el.height = prevSz;
    });
    this.renderer.resize();
    this.particles.cellMetrics = {
      cell:    this.renderer.CELL,
      gap:     this.renderer.GAP,
      padding: this.renderer.PADDING,
    };
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
    document.getElementById('game-container').classList.add('powerup-target');

    const onTap = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pt = e.touches ? e.touches[0] : e;
      const { row, col } = this.renderer._screenToGrid(pt.clientX, pt.clientY);
      if (row < 0) return; // tapped outside grid

      powerupHint.classList.add('hidden');
      document.getElementById('game-container').classList.remove('powerup-target');
      document.getElementById('fx-canvas').removeEventListener('pointerdown', onTap);
      document.getElementById('fx-canvas').removeEventListener('touchstart', onTap);

      this._applyTargetedPowerup(this._pendingPowerup, row, col);
      this._pendingPowerup = null;
    };

    const fxEl = document.getElementById('fx-canvas');
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
    const snap = {};
    for (const { row, col } of positions) {
      const cell = this.grid.get(row, col);
      if (!cell.isEmpty) snap[`${row},${col}`] = cell.colorID;
    }
    this.grid.clearMany(positions);
    this.particles.burstCells(positions, PALETTE, snap);
    const { delta } = this.scoreSystem.record({
      deletedBlocks: positions.length,
      clearedRows: [], clearedCols: [], colorClusters: [],
      now: performance.now(),
    });
    this.particles.spawnScoreFloat(positions, delta, label, PALETTE, snap);
    showToast(label);
    playCluster();
    updateCoinDisplays();
  }
}
