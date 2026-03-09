/**
 * particles.js — Canvas particle FX system.
 *
 * Two kinds of effects:
 *   1. CellBurst  — when a cell is cleared, it explodes outward as
 *                   tiny coloured squares that fade and drift out.
 *   2. ScoreFloat — a "+N" text floats upward from the cleared area.
 *
 * All particles are rendered on #fx-canvas by the game loop calling
 * particleSystem.tick(dt, ctx) each animation frame.
 */

const CELL    = 44;
const GAP     = 2;
const PADDING = 6;

function cellCenter(row, col, metrics) {
  const cell    = metrics?.cell    ?? CELL;
  const gap     = metrics?.gap     ?? GAP;
  const padding = metrics?.padding ?? PADDING;
  return {
    x: padding + col * (cell + gap) + cell / 2,
    y: padding + row * (cell + gap) + cell / 2,
  };
}

// ─── Easing ──────────────────────────────────────────────────────────────────

function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
function easeInQuad(t)  { return t * t; }

// ─── CellBurst Particle ───────────────────────────────────────────────────────

class Particle {
  constructor(x, y, hex) {
    this.x    = x;
    this.y    = y;
    this.hex  = hex;
    const angle    = Math.random() * Math.PI * 2;
    const speed    = 60 + Math.random() * 120;
    this.vx        = Math.cos(angle) * speed;
    this.vy        = Math.sin(angle) * speed;
    this.size      = 4 + Math.random() * 6;
    this.life      = 0;           // 0-1
    this.duration  = 0.5 + Math.random() * 0.4; // seconds
    this.rotation  = Math.random() * Math.PI * 2;
    this.rotSpeed  = (Math.random() - 0.5) * 10;
    this.gravity   = 150;
  }

  tick(dt) {
    this.life += dt / this.duration;
    this.x    += this.vx * dt;
    this.y    += this.vy * dt;
    this.vy   += this.gravity * dt;
    this.rotation += this.rotSpeed * dt;
    return this.life < 1;
  }

  draw(ctx) {
    const alpha = 1 - easeInQuad(this.life);
    const scale = 1 - this.life * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.fillStyle = this.hex;
    const s = this.size * scale;
    ctx.fillRect(-s/2, -s/2, s, s);
    ctx.restore();
  }
}

// ─── Floating Score Text ──────────────────────────────────────────────────────

class ScoreFloat {
  /**
   * Spawns a DOM element in #float-layer with a CSS animation.
   * tick() / draw() are no-ops — the browser handles the animation.
   */
  constructor(x, y, text, color, fontSize = 22) {
    this._done = false;
    const layer = document.getElementById('float-layer');
    if (!layer) { this._done = true; return; }

    const el = document.createElement('span');
    el.className   = 'score-float';
    el.textContent = text;
    el.style.left     = `${x}px`;
    el.style.top      = `${y}px`;
    el.style.fontSize = `${fontSize}px`;
    el.style.color    = color;
    el.style.textShadow = `0 0 10px ${color}`;
    const dur = 1.5;
    el.style.animationDuration = `${dur}s`;
    layer.appendChild(el);

    setTimeout(() => { el.remove(); this._done = true; }, dur * 1000 + 50);
  }

  tick()  { return !this._done; }
  draw()  { /* CSS handles it */ }
}

// ─── ParticleSystem ───────────────────────────────────────────────────────────

export class ParticleSystem {
  constructor() {
    /** @type {(Particle|ScoreFloat)[]} */
    this._particles = [];
    /** Set by Game after renderer is sized: { cell, gap, padding } */
    this.cellMetrics = null;
  }

  /**
   * Spawn burst particles for every cleared cell.
   * @param {{ row:number, col:number }[]} cells
   * @param {Object} palette  colorID → {hex}
   * @param {Object} colorSnapshot  "row,col" → colorID (captured before clear)
   */
  burstCells(cells, palette, colorSnapshot) {
    for (const { row, col } of cells) {
      const colorID = colorSnapshot[`${row},${col}`];
      const hex     = palette[colorID]?.hex ?? '#a78bfa';
      const { x, y } = cellCenter(row, col, this.cellMetrics);
      const count   = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        this._particles.push(new Particle(x, y, hex));
      }
    }
  }

  /**
   * Float a score label from the centroid of cleared cells.
   */
  spawnScoreFloat(cells, delta, label, palette, colorSnapshot) {
    if (cells.length === 0) return;
    const cx = cells.reduce((s, p) => s + cellCenter(p.row, p.col, this.cellMetrics).x, 0) / cells.length;
    const cy = cells.reduce((s, p) => s + cellCenter(p.row, p.col, this.cellMetrics).y, 0) / cells.length;

    const text  = label ? label : `+${delta}`;
    const color = label ? '#a78bfa' : '#60a5fa';
    this._particles.push(new ScoreFloat(cx, cy, text, color, label ? 26 : 22));

    if (label) {
      // Secondary "+N" score below the label
      this._particles.push(new ScoreFloat(cx, cy + 32, `+${delta}`, '#60a5fa', 18));
    }
  }

  /**
   * Advance all particles by dt seconds and render onto ctx.
   * @param {number} dt   seconds since last frame
   * @param {CanvasRenderingContext2D} ctx
   */
  tick(dt, ctx) {
    this._particles = this._particles.filter(p => {
      const alive = p.tick(dt);
      if (alive) p.draw(ctx);
      return alive;
    });
  }

  get hasParticles() { return this._particles.length > 0; }
}
