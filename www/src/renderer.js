/**
 * renderer.js — Canvas rendering with dynamic cell sizing and swappable skins.
 */

import { Grid }              from './grid.js';
import { COLORS as PALETTE } from './blocks.js';

const EMPTY_COLOR = '#1c1c34';
const GRID_LINE   = '#252545';

function _rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function easeOutElastic(t) {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10*t) * Math.sin((t*10 - 0.75) * c4) + 1;
}

function hexToRgba(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const _fallbackSkin = {
  drawCell(ctx, x, y, sz, hex, cr) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i+2), 16));
    const light = `#${[r, g, b].map(v => Math.min(255, Math.round(v + (255 - v) * 0.25)).toString(16).padStart(2, '0')).join('')}`;
    const grad = ctx.createLinearGradient(x, y, x+sz, y+sz);
    grad.addColorStop(0, light); grad.addColorStop(1, hex);
    _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    _rr(ctx, x+2, y+2, sz-4, Math.max(4, sz*.28), 2); ctx.fill();
  }
};

export class Renderer {
  constructor(grid, gridCanvas, fxCanvas) {
    this.grid       = grid;
    this.gridCanvas = gridCanvas;
    this.fxCanvas   = fxCanvas;
    this.gridCtx    = gridCanvas.getContext('2d');
    this.fxCtx      = fxCanvas.getContext('2d');
    this.skin       = _fallbackSkin;
    this.CELL = 30; this.GAP = 2; this.PADDING = 4; this.RADIUS = 4;
    this.tweens   = new Map();
    this.dragging = null;
    this.onDrop   = null;
    this._getBlockForIndex = () => null;
    this._ghostState = null; // { block, row, col, canPlace }
    this._bindDrag();
    this.resize();
  }

  resize() {
    const S      = this.gridCanvas.width;
    const N      = Grid.SIZE; // 8
    this.GAP     = Math.max(2, Math.floor(S * 0.008));
    this.PADDING = Math.max(2, Math.floor(S * 0.008));
    this.CELL    = Math.floor((S - this.PADDING*2 - this.GAP*(N-1)) / N);
    this.RADIUS  = Math.max(3, Math.floor(this.CELL * 0.12));
    this._drawGrid();
  }

  setSkin(skin) { this.skin = skin; this._drawGrid(); }

  _cellX(col) { return this.PADDING + col * (this.CELL + this.GAP); }
  _cellY(row) { return this.PADDING + row * (this.CELL + this.GAP); }

  _drawGrid() {
    // Fill entire canvas with gap colour first so inter-cell gaps are always clean
    this.gridCtx.fillStyle = GRID_LINE;
    this.gridCtx.fillRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
    for (let r = 0; r < Grid.SIZE; r++)
      for (let c = 0; c < Grid.SIZE; c++)
        this._drawCell(r, c);
  }

  redrawCells(cells) {
    for (const { row, col } of cells) {
      const cell = this.grid.get(row, col);
      if (!cell.isEmpty) this.tweens.set(`${row},${col}`, { progress: 0 });
      else this.tweens.delete(`${row},${col}`);
      this._drawCell(row, col);
    }
  }

  _drawCell(row, col) {
    const ctx = this.gridCtx;
    const cell = this.grid.get(row, col);
    const x = this._cellX(col), y = this._cellY(row);
    const sz = this.CELL, cr = this.RADIUS;
    const tw = this.tweens.get(`${row},${col}`);
    // Erase cell + 1px border so gap colour is always clean
    ctx.fillStyle = GRID_LINE;
    ctx.fillRect(x - 1, y - 1, sz + 2, sz + 2);
    // Clip to exact cell bounds — prevents skin shadow/stroke from bleeding onto neighbours
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, sz, sz); ctx.clip();
    if (cell.isEmpty) {
      ctx.fillStyle = EMPTY_COLOR;
      _rr(ctx, x, y, sz, sz, cr); ctx.fill();
      ctx.strokeStyle = GRID_LINE; ctx.lineWidth = 0.5; ctx.stroke();
    } else {
      const hex = PALETTE[cell.colorID]?.hex ?? '#888';
      const p   = tw ? tw.progress : 1;
      const sc  = p < 1 ? 0.76 + 0.24 * easeOutElastic(p) : 1;
      if (sc !== 1) {
        const cx = x+sz/2, cy = y+sz/2;
        ctx.translate(cx,cy); ctx.scale(sc,sc); ctx.translate(-cx,-cy);
      }
      ctx.globalAlpha = p < 0.08 ? p/0.08 : 1;
      this.skin.drawCell(ctx, x, y, sz, hex, cr);
    }
    ctx.restore();
  }

  tickTweens(dt) {
    for (const [key, tw] of this.tweens) {
      if (tw.progress >= 1) { this.tweens.delete(key); continue; }
      tw.progress = Math.min(tw.progress + dt / 0.32, 1);
      const [r,c] = key.split(',').map(Number);
      this._drawCell(r, c);
      if (tw.progress >= 1) this.tweens.delete(key);
    }
  }

  drawGhostAndHover(block, ghostRow, ghostCol, canPlace) {
    // Just update state — the game loop redraws it each frame to avoid flickering
    if (!block || ghostRow < 0) {
      this._ghostState = null;
    } else {
      this._ghostState = { block, row: ghostRow, col: ghostCol, canPlace };
    }
  }

  /** Called by the game loop each frame after clearing fxCtx. */
  redrawGhost() {
    const g = this._ghostState;
    if (!g) return;
    const ctx = this.fxCtx;
    const hex = PALETTE[g.block.colorID]?.hex ?? '#888';
    for (const [dr,dc] of g.block.cells) {
      const row = g.row+dr, col = g.col+dc;
      if (row<0||row>=Grid.SIZE||col<0||col>=Grid.SIZE) continue;
      const x=this._cellX(col), y=this._cellY(row);
      ctx.fillStyle   = g.canPlace ? hexToRgba(hex,.4) : 'rgba(255,50,50,0.25)';
      ctx.strokeStyle = g.canPlace ? hex : '#ff4444';
      ctx.lineWidth   = 2;
      _rr(ctx,x,y,this.CELL,this.CELL,this.RADIUS);
      ctx.fill(); ctx.stroke();
    }
  }

  clearFx() { this.fxCtx.clearRect(0,0,this.fxCanvas.width,this.fxCanvas.height); }

  drawBlockPreview(el, block) {
    const ctx = el.getContext('2d');
    ctx.clearRect(0,0,el.width,el.height);
    if (!block) return;
    const bb  = block.getBoundingBox();
    const avail = Math.min(el.width,el.height)-10;
    const cs  = Math.floor(avail/Math.max(bb.rows,bb.cols,1));
    const gap = 2;
    const ox  = Math.round((el.width -bb.cols*(cs+gap)+gap)/2);
    const oy  = Math.round((el.height-bb.rows*(cs+gap)+gap)/2);
    const hex = PALETTE[block.colorID]?.hex ?? '#888';
    const cr  = Math.max(2, Math.floor(cs*.14));
    for (const [dr,dc] of block.cells)
      this.skin.drawCell(ctx, ox+dc*(cs+gap), oy+dr*(cs+gap), cs, hex, cr);
  }

  /**
   * Given a raw (row,col) under the finger, find the nearest grid position
   * where `block` can be placed. Searches outward in a spiral up to `maxDist`
   * cells away. Returns {row, col, canPlace} with canPlace=false if nothing fits.
   */
  _snapToNearest(block, rawRow, rawCol, maxDist = 3) {
    // Fast path: exact position fits
    if (rawRow >= 0 && this.grid.canPlace(block.getAbsolutePositions(rawRow, rawCol)))
      return { row: rawRow, col: rawCol, canPlace: true };

    let best = null, bestDist = Infinity;
    for (let dr = -maxDist; dr <= maxDist; dr++) {
      for (let dc = -maxDist; dc <= maxDist; dc++) {
        const r = rawRow + dr, c = rawCol + dc;
        if (r < 0 || c < 0 || r >= Grid.SIZE || c >= Grid.SIZE) continue;
        const d = Math.abs(dr) + Math.abs(dc);
        if (d >= bestDist) continue;
        if (this.grid.canPlace(block.getAbsolutePositions(r, c))) {
          best = { row: r, col: c };
          bestDist = d;
        }
      }
    }
    if (best) return { ...best, canPlace: true };
    // Nothing fits nearby — show red ghost at raw position
    return { row: Math.max(0, Math.min(Grid.SIZE - 1, rawRow)), col: Math.max(0, Math.min(Grid.SIZE - 1, rawCol)), canPlace: false };
  }

  _updateGhostFromPoint(x, y) {
    if (!this.dragging) return;
    const bb   = this.dragging.block.getBoundingBox();
    const step = this.CELL + this.GAP;

    const rect   = this.gridCanvas.getBoundingClientRect();
    const scaleX = this.gridCanvas.width  / rect.width;
    const scaleY = this.gridCanvas.height / rect.height;

    // Treat finger as if it were LIFT_PX screen-pixels higher, block centered on finger X.
    // This keeps the ghost on the grid even when the finger is in the piece tray below.
    const LIFT_PX = 100;
    const canvasX = (x - rect.left) * scaleX;
    const canvasY = (y - rect.top)  * scaleY - LIFT_PX * scaleY;
    const rawRow  = Math.floor((canvasY - this.PADDING) / step);
    const rawCol  = Math.floor((canvasX - this.PADDING) / step - bb.cols / 2);

    // Always keep ghost visible — clamp to grid bounds, never hide
    const clampedRow = Math.max(0, Math.min(Grid.SIZE - 1, rawRow));
    const clampedCol = Math.max(0, Math.min(Grid.SIZE - 1, rawCol));

    const snap = this._snapToNearest(this.dragging.block, clampedRow, clampedCol);
    this._lastSnap = snap;
    this.drawGhostAndHover(this.dragging.block, snap.row, snap.col, snap.canPlace);
  }

  _bindDrag() {
    let _rafPending = false;
    let _lastPt = null;
    const onMove = (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      const pt = e.touches ? e.touches[0] : e;
      _lastPt = { x: pt.clientX, y: pt.clientY };
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(() => {
        _rafPending = false;
        if (!this.dragging || !_lastPt) return;
        this._updateGhostFromPoint(_lastPt.x, _lastPt.y);
      });
    };
    const onUp = (e) => {
      if (!this.dragging) return;
      const snapped = this._lastSnap;
      if (snapped && snapped.canPlace && this.onDrop)
        this.onDrop(this.dragging.block, this.dragging.el, snapped.row, snapped.col);
      this.dragging.el.classList.remove('dragging');
      this._ghostState = null;
      this.dragging = null; _lastPt = null; this._lastSnap = null; _rafPending = false;
    };
    document.querySelectorAll('.block-preview').forEach((el, idx) => {
      const start = this._makeStartHandler(el, idx);
      el.addEventListener('mousedown',  start);
      el.addEventListener('touchstart', start, {passive:false});
    });
    window.addEventListener('mousemove',  onMove);
    window.addEventListener('touchmove',  onMove, {passive:false});
    window.addEventListener('mouseup',    onUp);
    window.addEventListener('touchend',   onUp);
  }

  _makeStartHandler(el, idx) {
    return (e) => {
      e.preventDefault();
      const block = this._getBlockForIndex(idx);
      if (!block || el.classList.contains('used')) return;
      this.dragging = { block, el, idx };
      el.classList.add('dragging');
      // Show ghost immediately at the initial touch/click position
      const pt = e.touches ? e.touches[0] : e;
      this._updateGhostFromPoint(pt.clientX, pt.clientY);
    };
  }

  _screenToGrid(sx, sy) {
    const rect  = this.gridCanvas.getBoundingClientRect();
    const scaleX = this.gridCanvas.width  / rect.width;
    const scaleY = this.gridCanvas.height / rect.height;
    const px = (sx - rect.left) * scaleX;
    const py = (sy - rect.top)  * scaleY;
    const col = Math.floor((px - this.PADDING) / (this.CELL + this.GAP));
    const row = Math.floor((py - this.PADDING) / (this.CELL + this.GAP));
    if (row<0||row>=Grid.SIZE||col<0||col>=Grid.SIZE) return {row:-1,col:-1};
    return {row, col};
  }

  setBlockProvider(fn) { this._getBlockForIndex = fn; }

  /** Re-bind drag start listeners (call after new .block-preview elements are added). */
  rebindDrag() {
    document.querySelectorAll('.block-preview').forEach((el, idx) => {
      const clone = el.cloneNode(true);
      el.replaceWith(clone);
      const start = this._makeStartHandler(clone, idx);
      clone.addEventListener('mousedown',  start);
      clone.addEventListener('touchstart', start, { passive: false });
    });
  }
}
