/**
 * renderer.js — Canvas rendering and drag-and-drop interaction.
 *
 * Two canvases are stacked:
 *   #grid-canvas  — background grid + placed blocks (redrawn on grid change)
 *   #fx-canvas    — particle effects + drag ghost (redrawn every frame)
 *
 * Drag-and-drop works on both mouse and touch events.
 * On drop, calls game.tryPlace(block, gridRow, gridCol).
 */

import { COLORS, Grid } from './grid.js';
// Re-export palette reference (grid.js exports Grid, blocks.js exports COLORS)
// We import COLORS from blocks to avoid circular deps.
import { COLORS as PALETTE } from './blocks.js';

const CELL    = 44;   // px per grid cell
const GAP     = 2;    // px gap between cells
const RADIUS  = 6;    // corner radius
const PADDING = 6;    // canvas inner padding

// Subtle cell background colours for empty / filled states
const EMPTY_COLOR = '#1e1e36';
const GRID_LINE   = '#2a2a4a';

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export class Renderer {
  /**
   * @param {import('./grid.js').Grid} grid
   * @param {HTMLCanvasElement} gridCanvas
   * @param {HTMLCanvasElement} fxCanvas
   */
  constructor(grid, gridCanvas, fxCanvas) {
    this.grid        = grid;
    this.gridCanvas  = gridCanvas;
    this.fxCanvas    = fxCanvas;
    this.gridCtx     = gridCanvas.getContext('2d');
    this.fxCtx       = fxCanvas.getContext('2d');

    /** @type {{ block: import('./blocks.js').Block, el: HTMLCanvasElement }|null} */
    this.dragging    = null;
    /** Mouse position relative to viewport */
    this.dragX       = 0;
    this.dragY       = 0;
    /** Grid cell hovered during drag */
    this.hoverRow    = -1;
    this.hoverCol    = -1;

    /** Tween table: "row,col" → { progress 0-1, targetColor } */
    this.tweens      = new Map();

    /** Callback set by Game when a drop is valid */
    this.onDrop      = null;

    this._drawGrid();
    this._bindDrag();
  }

  // ─── Grid Canvas ─────────────────────────────────────────────────────────

  _cellX(col) { return PADDING + col * (CELL + GAP); }
  _cellY(row) { return PADDING + row * (CELL + GAP); }

  _drawGrid() {
    const ctx  = this.gridCtx;
    const SIZE = Grid.SIZE;
    ctx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = this.grid.get(r, c);
        const x    = this._cellX(c);
        const y    = this._cellY(r);
        const tw   = this.tweens.get(`${r},${c}`);

        if (cell.isEmpty) {
          ctx.fillStyle = EMPTY_COLOR;
          drawRoundRect(ctx, x, y, CELL, CELL, RADIUS);
          ctx.fill();
          // Subtle grid line
          ctx.strokeStyle = GRID_LINE;
          ctx.lineWidth   = 0.5;
          ctx.stroke();
        } else {
          const hex   = PALETTE[cell.colorID]?.hex ?? '#888';
          // Tween: lerp from white flash to actual colour
          let color   = hex;
          if (tw && tw.progress < 1) {
            color = lerpColor('#ffffff', hex, easeOutElastic(tw.progress));
          }
          const grd = ctx.createLinearGradient(x, y, x + CELL, y + CELL);
          grd.addColorStop(0, lightenHex(hex, 0.25));
          grd.addColorStop(1, hex);
          ctx.fillStyle = tw ? color : grd;
          drawRoundRect(ctx, x, y, CELL, CELL, RADIUS);
          ctx.fill();

          // Inner shine
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          drawRoundRect(ctx, x + 3, y + 3, CELL - 6, 8, 3);
          ctx.fill();
        }
      }
    }
  }

  /** Re-draw only the changed cells for efficiency */
  redrawCells(cells) {
    const ctx  = this.gridCtx;
    const SIZE = Grid.SIZE;

    for (const { row, col } of cells) {
      const cell = this.grid.get(row, col);
      const x    = this._cellX(col);
      const y    = this._cellY(row);

      // Start tween for newly filled cells
      if (!cell.isEmpty) {
        this.tweens.set(`${row},${col}`, { progress: 0, colorID: cell.colorID });
      } else {
        this.tweens.delete(`${row},${col}`);
      }

      this._redrawCell(row, col);
    }
  }

  _redrawCell(row, col) {
    const ctx  = this.gridCtx;
    const cell = this.grid.get(row, col);
    const x    = this._cellX(col);
    const y    = this._cellY(row);
    const tw   = this.tweens.get(`${row},${col}`);

    ctx.clearRect(x - 1, y - 1, CELL + 2, CELL + 2);

    if (cell.isEmpty) {
      ctx.fillStyle = EMPTY_COLOR;
      drawRoundRect(ctx, x, y, CELL, CELL, RADIUS);
      ctx.fill();
      ctx.strokeStyle = GRID_LINE;
      ctx.lineWidth   = 0.5;
      ctx.stroke();
    } else {
      const hex   = PALETTE[cell.colorID]?.hex ?? '#888';
      let alpha   = tw ? easeOutElastic(tw.progress) : 1;
      // scale cell slightly during tween
      const scale = tw ? 0.8 + 0.2 * easeOutElastic(tw.progress) : 1;
      const cx    = x + CELL / 2;
      const cy    = y + CELL / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);

      const grd = ctx.createLinearGradient(x, y, x + CELL, y + CELL);
      grd.addColorStop(0, lightenHex(hex, 0.25));
      grd.addColorStop(1, hex);
      ctx.fillStyle = grd;
      ctx.globalAlpha = alpha;
      drawRoundRect(ctx, x, y, CELL, CELL, RADIUS);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.08;
      ctx.fillStyle = '#fff';
      drawRoundRect(ctx, x + 3, y + 3, CELL - 6, 8, 3);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /** Advances all active tweens. Called every animation frame. */
  tickTweens(dt) {
    let needRedraw = false;
    for (const [key, tw] of this.tweens) {
      if (tw.progress >= 1) continue;
      tw.progress = Math.min(tw.progress + dt / 350, 1); // 350ms duration
      const [r, c] = key.split(',').map(Number);
      this._redrawCell(r, c);
      needRedraw = true;
    }
    return needRedraw;
  }

  // ─── Hover / Ghost overlay on fx canvas ──────────────────────────────────

  drawGhostAndHover(block, ghostRow, ghostCol, canPlace) {
    const ctx  = this.fxCtx;
    ctx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);

    if (!block || ghostRow < 0) return;

    const hex   = PALETTE[block.colorID]?.hex ?? '#888';
    const alpha = canPlace ? 0.45 : 0.2;

    for (const [dr, dc] of block.cells) {
      const row = ghostRow + dr;
      const col = ghostCol + dc;
      if (row < 0 || row >= Grid.SIZE || col < 0 || col >= Grid.SIZE) continue;
      const x = this._cellX(col);
      const y = this._cellY(row);
      ctx.fillStyle   = canPlace ? hexToRgba(hex, alpha) : 'rgba(255,60,60,0.25)';
      ctx.strokeStyle = canPlace ? hex : '#ff4444';
      ctx.lineWidth   = 2;
      drawRoundRect(ctx, x, y, CELL, CELL, RADIUS);
      ctx.fill();
      ctx.stroke();
    }
  }

  clearFx() {
    this.fxCtx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
  }

  // ─── Block Preview Canvases ───────────────────────────────────────────────

  /**
   * Renders block preview onto one of the tray canvases.
   * @param {HTMLCanvasElement} el
   * @param {import('./blocks.js').Block|null} block
   */
  drawBlockPreview(el, block) {
    const ctx = el.getContext('2d');
    ctx.clearRect(0, 0, el.width, el.height);

    if (!block) return;

    const bb    = block.getBoundingBox();
    const avail = Math.min(el.width, el.height) - 16;
    const cs    = Math.floor(avail / Math.max(bb.rows, bb.cols));
    const gap   = 2;
    const ox    = Math.round((el.width  - bb.cols * (cs + gap) + gap) / 2);
    const oy    = Math.round((el.height - bb.rows * (cs + gap) + gap) / 2);
    const hex   = PALETTE[block.colorID]?.hex ?? '#888';

    for (const [dr, dc] of block.cells) {
      const x = ox + dc * (cs + gap);
      const y = oy + dr * (cs + gap);
      const grd = ctx.createLinearGradient(x, y, x + cs, y + cs);
      grd.addColorStop(0, lightenHex(hex, 0.3));
      grd.addColorStop(1, hex);
      ctx.fillStyle = grd;
      drawRoundRect(ctx, x, y, cs, cs, Math.max(2, cs * 0.15));
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      drawRoundRect(ctx, x + 2, y + 2, cs - 4, cs * 0.3, 2);
      ctx.fill();
    }
  }

  // ─── Drag & Drop ─────────────────────────────────────────────────────────

  _bindDrag() {
    const previews = document.querySelectorAll('.block-preview');

    const pointerMove = (e) => {
      if (!this.dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      this.dragX = pt.clientX;
      this.dragY = pt.clientY;

      const { row, col } = this._screenToGrid(pt.clientX, pt.clientY);
      this.hoverRow = row;
      this.hoverCol = col;

      const canPlace = row >= 0
        ? this.grid.canPlace(
            this.dragging.block.getAbsolutePositions(row, col)
          )
        : false;

      this.drawGhostAndHover(this.dragging.block, row, col, canPlace);
    };

    const pointerUp = (e) => {
      if (!this.dragging) return;
      const pt = e.changedTouches ? e.changedTouches[0] : e;
      const { row, col } = this._screenToGrid(pt.clientX, pt.clientY);

      if (row >= 0 && this.onDrop) {
        this.onDrop(this.dragging.block, this.dragging.el, row, col);
      }

      this.dragging.el.classList.remove('dragging');
      this.dragging = null;
      this.clearFx();
    };

    previews.forEach((el, idx) => {
      const startDrag = (e) => {
        e.preventDefault();
        const block = this._getBlockForIndex(idx);
        if (!block || el.classList.contains('used')) return;
        this.dragging = { block, el, idx };
        el.classList.add('dragging');
      };

      el.addEventListener('mousedown',  startDrag);
      el.addEventListener('touchstart', startDrag, { passive: false });
    });

    window.addEventListener('mousemove',  pointerMove);
    window.addEventListener('touchmove',  pointerMove, { passive: false });
    window.addEventListener('mouseup',    pointerUp);
    window.addEventListener('touchend',   pointerUp);
  }

  /** Converts screen coords to grid row/col. Returns -1,-1 if outside. */
  _screenToGrid(screenX, screenY) {
    const rect = this.gridCanvas.getBoundingClientRect();
    const lx   = screenX - rect.left;
    const ly   = screenY - rect.top;

    // Account for canvas scaling (CSS size vs canvas pixel size)
    const scaleX = this.gridCanvas.width  / rect.width;
    const scaleY = this.gridCanvas.height / rect.height;
    const px     = lx * scaleX;
    const py     = ly * scaleY;

    const col = Math.floor((px - PADDING) / (CELL + GAP));
    const row = Math.floor((py - PADDING) / (CELL + GAP));

    if (row < 0 || row >= Grid.SIZE || col < 0 || col >= Grid.SIZE)
      return { row: -1, col: -1 };
    return { row, col };
  }

  /** Set by Game so renderer can look up current tray */
  setBlockProvider(fn) { this._getBlockForIndex = fn; }
}

// ─── Colour Math ─────────────────────────────────────────────────────────────

function lightenHex(hex, amount) {
  let r = parseInt(hex.slice(1,3),16);
  let g = parseInt(hex.slice(3,5),16);
  let b = parseInt(hex.slice(5,7),16);
  r = Math.min(255, Math.round(r + (255-r) * amount));
  g = Math.min(255, Math.round(g + (255-g) * amount));
  b = Math.min(255, Math.round(b + (255-b) * amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function lerpColor(hexA, hexB, t) {
  const ra=parseInt(hexA.slice(1,3),16), ga=parseInt(hexA.slice(3,5),16), ba=parseInt(hexA.slice(5,7),16);
  const rb=parseInt(hexB.slice(1,3),16), gb=parseInt(hexB.slice(3,5),16), bb=parseInt(hexB.slice(5,7),16);
  const r=Math.round(ra+(rb-ra)*t), g=Math.round(ga+(gb-ga)*t), b=Math.round(ba+(bb-ba)*t);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// Elastic-out easing (the "bouncy" feel)
function easeOutElastic(t) {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}
