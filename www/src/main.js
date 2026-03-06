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
let game      = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const startScreen  = document.getElementById('start-screen');
const mainApp      = document.getElementById('main-app');
const pagePlay     = document.getElementById('page-play');
const pageSkins    = document.getElementById('page-skins');
const overlayEl    = document.getElementById('gameover-overlay');
const toastEl      = document.getElementById('feedback-toast');
const buyRandomBtn = document.getElementById('buy-random-btn');
const skinsGrid    = document.getElementById('skins-grid');

// Update start screen
document.getElementById('ss-best').textContent  = Number(localStorage.getItem('weaverBest') ?? 0).toLocaleString();
document.getElementById('ss-coins').textContent = economy.coins;

// ── Navigation ───────────────────────────────────────────────────────────────

function showPage(name) {
  pagePlay.classList.toggle('hidden',  name !== 'play');
  pageSkins.classList.toggle('hidden', name !== 'skins');
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.page === name)
  );
  if (name === 'skins') renderSkinsPage();
}

document.querySelectorAll('.nav-btn').forEach(btn =>
  btn.addEventListener('click', () => showPage(btn.dataset.page))
);

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

// ── Buy random skin ──────────────────────────────────────────────────────────

buyRandomBtn.addEventListener('click', () => {
  const result = economy.buyRandom();
  if (result.type === 'noCoins')    showToast('Need 100 \uD83E\uDE99!');
  else if (result.type === 'allOwned') showToast('All skins owned!');
  else {
    showToast(`Got: ${result.skin.name}!`);
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
  if (eC) eC.textContent = c;
  if (eS) eS.textContent = c;
}

let _toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
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
    for (let i = 0; i < TRAY_SIZE; i++) {
      const el = document.getElementById(`block${i}`);
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
    }

    if (this.tray.filter(Boolean).length > 0 && isGameOver(this.tray.filter(Boolean), this.grid))
      setTimeout(() => this._gameOver(), 400);
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  _loop(last) {
    const now = performance.now();
    const dt  = Math.min((now - last) / 1000, 0.05);
    this.renderer.tickTweens(dt);
    if (this.particles.hasParticles) {
      this.renderer.fxCtx.clearRect(0, 0, this.renderer.fxCanvas.width, this.renderer.fxCanvas.height);
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
    this._renderTray();
  }
}
