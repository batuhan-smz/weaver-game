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
    const ri=parseInt(hex.slice(1,3),16), gi=parseInt(hex.slice(3,5),16), bi=parseInt(hex.slice(5,7),16);
    const light = `#${Math.min(255,Math.round(ri+(255-ri)*.25)).toString(16).padStart(2,'0')}${Math.min(255,Math.round(gi+(255-gi)*.25)).toString(16).padStart(2,'0')}${Math.min(255,Math.round(bi+(255-bi)*.25)).toString(16).padStart(2,'0')}`;
    const g = ctx.createLinearGradient(x, y, x+sz, y+sz);
    g.addColorStop(0, light); g.addColorStop(1, hex);
    _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = g; ctx.fill();
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
    this._bindDrag();
    this.resize();
  }

  resize() {
    const S      = this.gridCanvas.width;
    this.GAP     = 2;
    this.PADDING = Math.max(3, Math.floor(S * 0.012));
    this.CELL    = Math.floor((S - this.PADDING*2 - this.GAP*9) / 10);
    this.RADIUS  = Math.max(3, Math.floor(this.CELL * 0.14));
    this._drawGrid();
  }

  setSkin(skin) { this.skin = skin; this._drawGrid(); }

  _cellX(col) { return this.PADDING + col * (this.CELL + this.GAP); }
  _cellY(row) { return this.PADDING + row * (this.CELL + this.GAP); }

  _drawGrid() {
    this.gridCtx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
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
    ctx.clearRect(x-1, y-1, sz+2, sz+2);
    if (cell.isEmpty) {
      ctx.fillStyle = EMPTY_COLOR;
      _rr(ctx, x, y, sz, sz, cr); ctx.fill();
      ctx.strokeStyle = GRID_LINE; ctx.lineWidth = 0.5; ctx.stroke();
    } else {
      const hex = PALETTE[cell.colorID]?.hex ?? '#888';
      const p   = tw ? tw.progress : 1;
      const sc  = p < 1 ? 0.76 + 0.24 * easeOutElastic(p) : 1;
      ctx.save();
      if (sc !== 1) {
        const cx = x+sz/2, cy = y+sz/2;
        ctx.translate(cx,cy); ctx.scale(sc,sc); ctx.translate(-cx,-cy);
      }
      ctx.globalAlpha = Math.min(1, p < 0.08 ? p/0.08 : 1);
      this.skin.drawCell(ctx, x, y, sz, hex, cr);
      ctx.restore(); ctx.globalAlpha = 1;
    }
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
    const ctx = this.fxCtx;
    ctx.clearRect(0,0,this.fxCanvas.width,this.fxCanvas.height);
    if (!block || ghostRow < 0) return;
    const hex = PALETTE[block.colorID]?.hex ?? '#888';
    for (const [dr,dc] of block.cells) {
      const row=ghostRow+dr, col=ghostCol+dc;
      if (row<0||row>=Grid.SIZE||col<0||col>=Grid.SIZE) continue;
      const x=this._cellX(col), y=this._cellY(row);
      ctx.fillStyle   = canPlace ? hexToRgba(hex,.4) : 'rgba(255,50,50,0.25)';
      ctx.strokeStyle = canPlace ? hex : '#ff4444';
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
        const {row,col} = this._screenToGrid(_lastPt.x, _lastPt.y);
        const canPlace = row>=0 ? this.grid.canPlace(this.dragging.block.getAbsolutePositions(row,col)) : false;
        this.drawGhostAndHover(this.dragging.block, row, col, canPlace);
      });
    };
    const onUp = (e) => {
      if (!this.dragging) return;
      const pt = e.changedTouches ? e.changedTouches[0] : e;
      const {row,col} = this._screenToGrid(pt.clientX, pt.clientY);
      if (row>=0 && this.onDrop) this.onDrop(this.dragging.block, this.dragging.el, row, col);
      this.dragging.el.classList.remove('dragging');
      this.dragging = null; _lastPt = null; _rafPending = false;
      // fxCtx cleared by the game loop next frame — don't wipe live particles here
    };
    document.querySelectorAll('.block-preview').forEach((el,idx) => {
      const start = (e) => {
        e.preventDefault();
        const block = this._getBlockForIndex(idx);
        if (!block || el.classList.contains('used')) return;
        this.dragging = {block, el, idx};
        el.classList.add('dragging');
      };
      el.addEventListener('mousedown',  start);
      el.addEventListener('touchstart', start, {passive:false});
    });
    window.addEventListener('mousemove',  onMove);
    window.addEventListener('touchmove',  onMove, {passive:false});
    window.addEventListener('mouseup',    onUp);
    window.addEventListener('touchend',   onUp);
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
}
