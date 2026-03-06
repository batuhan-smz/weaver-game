/**
 * main.js — Game orchestrator / main loop.
 *
 * Wires together Grid, Renderer, ParticleSystem, ScoreSystem,
 * clearing logic, block generation, and game-over detection.
 *
 * Difficulty flow-balance:
 *   Every 5 successful placements a "hard" tray is generated that
 *   includes at least one awkward piece (H5/V5/PLUS) to break flow.
 */

import { Grid }             from './grid.js';
import { generateTray }     from './blocks.js';
import { COLORS as PALETTE} from './blocks.js';
import { Renderer }         from './renderer.js';
import { runClearingLogic } from './clearing.js';
import { ScoreSystem }      from './score.js';
import { ParticleSystem }   from './particles.js';
import { isGameOver }       from './gameover.js';

const TRAY_SIZE         = 4;
const HARD_EVERY        = 5;   // every N placements inject a hard tray

class Game {
  constructor() {
    this.grid        = new Grid();
    this.scoreSystem = new ScoreSystem();
    this.particles   = new ParticleSystem();

    // Canvas elements
    const gridCanvas = document.getElementById('grid-canvas');
    const fxCanvas   = document.getElementById('fx-canvas');
    this.renderer    = new Renderer(this.grid, gridCanvas, fxCanvas);

    // Tray state
    /** @type {(import('./blocks.js').Block|null)[]} */
    this.tray        = [];
    this.usedMask    = [];   // bool[] — which slots are used
    this.placements  = 0;    // total successful block placements

    // UI refs
    this.scoreEl   = document.getElementById('score-display');
    this.bestEl    = document.getElementById('best-display');
    this.comboEl   = document.getElementById('combo-display');
    this.toastEl   = document.getElementById('feedback-toast');
    this.overlayEl = document.getElementById('gameover-overlay');
    this.finalEl   = document.getElementById('final-score');

    document.getElementById('restart-btn').addEventListener('click', () => this.restart());

    // Grid observer → redraw on change
    this.grid.onChange(cells => this.renderer.redrawCells(cells));

    // Score observer → update UI
    this.scoreSystem.onChange(ss => {
      this.scoreEl.textContent = ss.score.toLocaleString();
      this.bestEl.textContent  = ss.best.toLocaleString();
      this.comboEl.textContent = `x${ss.comboMultiplier}`;
    });

    // Renderer drop handler
    this.renderer.onDrop = (block, el, row, col) => this._handleDrop(block, el, row, col);

    // This lets the renderer look up the live tray
    this.renderer.setBlockProvider(idx => this.tray[idx] ?? null);

    this._dealTray();
    this._loop(performance.now());
  }

  // ─── Tray ────────────────────────────────────────────────────────────────

  _dealTray() {
    const hard = (this.placements > 0) && (this.placements % HARD_EVERY === 0);
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
    const el = document.getElementById(`block${idx}`);
    el.classList.add('used');
    this.tray[idx] = null;

    // If all blocks used, deal a fresh tray
    if (this.tray.every(b => b === null)) {
      setTimeout(() => this._dealTray(), 300);
    }
  }

  // ─── Drop Handler ────────────────────────────────────────────────────────

  _handleDrop(block, el, row, col) {
    const positions = block.getAbsolutePositions(row, col);

    if (!this.grid.canPlace(positions)) return; // invalid — ghost already shows red

    // ── Snapshot color map before placement (for particles) ──
    const colorSnapshot = {};
    for (let r = 0; r < Grid.SIZE; r++)
      for (let c = 0; c < Grid.SIZE; c++) {
        const cell = this.grid.get(r, c);
        if (!cell.isEmpty) colorSnapshot[`${r},${c}`] = cell.colorID;
      }

    // ── Place block ──────────────────────────────────────────
    this.grid.fillMany(positions, block.colorID, block.id);

    // Add placed cells to snapshot (for their own burst if cleared)
    for (const { row: r, col: c } of positions)
      colorSnapshot[`${r},${c}`] = block.colorID;

    this.placements++;

    // ── Find the tray index for this block ───────────────────
    const idx = this.tray.findIndex(b => b?.id === block.id);
    if (idx !== -1) this._markUsed(idx);

    // ── Run clearing ─────────────────────────────────────────
    const result = runClearingLogic(this.grid, positions);

    if (result.totalCleared > 0) {
      // Particle burst
      this.particles.burstCells(result.cleared, PALETTE, colorSnapshot);

      // Score
      const { delta, label } = this.scoreSystem.record({
        deletedBlocks: result.totalCleared,
        clearedRows:   result.clearedRows.length,
        clearedCols:   result.clearedCols.length,
        colorClusters: result.colorClusters.length,
        now:           performance.now(),
      });

      this.particles.spawnScoreFloat(result.cleared, delta, label, PALETTE, colorSnapshot);
      if (label) this._showToast(label);
    }

    // ── Game over check ───────────────────────────────────────
    const remaining = this.tray.filter(Boolean);
    if (remaining.length > 0 && isGameOver(remaining, this.grid)) {
      setTimeout(() => this._gameOver(), 400);
    }
  }

  // ─── Animation Loop ──────────────────────────────────────────────────────

  _loop(last) {
    const now = performance.now();
    const dt  = Math.min((now - last) / 1000, 0.05); // cap at 50ms

    // Advance tweens on grid canvas
    this.renderer.tickTweens(dt);

    // Advance particles on fx canvas
    if (this.particles.hasParticles) {
      this.renderer.fxCtx.clearRect(
        0, 0,
        this.renderer.fxCanvas.width,
        this.renderer.fxCanvas.height
      );
      this.particles.tick(dt, this.renderer.fxCtx);
    }

    requestAnimationFrame(t => this._loop(t));
  }

  // ─── Toast ───────────────────────────────────────────────────────────────

  _toastTimer = null;
  _showToast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1400);
  }

  // ─── Game Over ───────────────────────────────────────────────────────────

  _gameOver() {
    this.finalEl.textContent = this.scoreSystem.score.toLocaleString();
    this.overlayEl.classList.remove('hidden');
  }

  restart() {
    this.overlayEl.classList.add('hidden');
    this.grid.reset();
    this.scoreSystem.reset();
    this.particles._particles = [];
    this.placements = 0;
    this._dealTray();
  }
}

// Boot
new Game();
