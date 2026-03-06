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

function cellCenter(row, col) {
  return {
    x: PADDING + col * (CELL + GAP) + CELL / 2,
    y: PADDING + row * (CELL + GAP) + CELL / 2,
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
  constructor(x, y, text, color) {
    this.x        = x;
    this.y        = y;
    this.text     = text;
    this.color    = color;
    this.life     = 0;
    this.duration = 1.1;
  }

  tick(dt) {
    this.life += dt / this.duration;
    this.y    -= 40 * dt;       // drift upward
    return this.life < 1;
  }

  draw(ctx) {
    const alpha = this.life < 0.7 ? 1 : 1 - (this.life - 0.7) / 0.3;
    const scale = this.life < 0.15
      ? easeOutQuad(this.life / 0.15) * 1.4
      : 1 + Math.max(0, 1.4 - 1 - this.life * 0.5);

    ctx.save();
    ctx.globalAlpha   = alpha;
    ctx.font          = `bold ${Math.round(22 * scale)}px 'Segoe UI', sans-serif`;
    ctx.textAlign     = 'center';
    ctx.fillStyle     = this.color;
    ctx.shadowColor   = this.color;
    ctx.shadowBlur    = 12;
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

// ─── ParticleSystem ───────────────────────────────────────────────────────────

export class ParticleSystem {
  constructor() {
    /** @type {(Particle|ScoreFloat)[]} */
    this._particles = [];
  }

  /**
   * Spawn burst particles for every cleared cell.
   * @param {{ row:number, col:number }[]} cells
   * @param {Object} palette  colorID → {hex}
   * @param {import('./grid.js').Grid} grid    snapshot BEFORE clearing
   * @param {Object} colorSnapshot  "row,col" → colorID (captured before clear)
   */
  burstCells(cells, palette, colorSnapshot) {
    for (const { row, col } of cells) {
      const colorID = colorSnapshot[`${row},${col}`];
      const hex     = palette[colorID]?.hex ?? '#a78bfa';
      const { x, y } = cellCenter(row, col);
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
    const cx = cells.reduce((s, p) => s + cellCenter(p.row, p.col).x, 0) / cells.length;
    const cy = cells.reduce((s, p) => s + cellCenter(p.row, p.col).y, 0) / cells.length;

    const text  = label ? label : `+${delta}`;
    const color = label ? '#a78bfa' : '#60a5fa';
    this._particles.push(new ScoreFloat(cx, cy, text, color));

    if (label) {
      // Secondary "+N" below the label
      this._particles.push(new ScoreFloat(cx, cy + 28, `+${delta}`, '#60a5fa'));
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
