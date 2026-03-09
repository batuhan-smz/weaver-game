/**
 * skins.js — 10 block skin definitions + EconomyStore (coins & unlocks).
 *
 * Each skin exposes:
 *   drawCell(ctx, x, y, size, colorHex, cornerRadius)
 *
 * Economy:
 *   - 1 coin earned per 1000 score points
 *   - Random locked skin costs 100 coins
 *   - Persisted in localStorage under 'weaverEconomy'
 */

// ─── Drawing Helpers ─────────────────────────────────────────────────────────

function _rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function _lighten(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const nr = Math.min(255,Math.round(r+(255-r)*a));
  const ng = Math.min(255,Math.round(g+(255-g)*a));
  const nb = Math.min(255,Math.round(b+(255-b)*a));
  return `#${nr.toString(16).padStart(2,'0')}${ng.toString(16).padStart(2,'0')}${nb.toString(16).padStart(2,'0')}`;
}

function _darken(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `#${Math.round(r*(1-a)).toString(16).padStart(2,'0')}${Math.round(g*(1-a)).toString(16).padStart(2,'0')}${Math.round(b*(1-a)).toString(16).padStart(2,'0')}`;
}

function _pastel(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `#${Math.min(255,Math.round(r*0.45+155)).toString(16).padStart(2,'0')}${Math.min(255,Math.round(g*0.45+155)).toString(16).padStart(2,'0')}${Math.min(255,Math.round(b*0.45+155)).toString(16).padStart(2,'0')}`;
}

// ─── 10 Skins ────────────────────────────────────────────────────────────────

export const SKINS = [
  {
    id: 'classic', name: 'Classic', desc: 'The original look', price: 0,
    previewColor: '#a78bfa',
    drawCell(ctx, x, y, sz, hex, cr) {
      const g = ctx.createLinearGradient(x, y, x+sz, y+sz);
      g.addColorStop(0, _lighten(hex, .25)); g.addColorStop(1, hex);
      _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      _rr(ctx, x+2, y+2, sz-4, Math.max(4, sz*0.28), 2); ctx.fill();
    }
  },
  {
    id: 'neon', name: 'Neon', desc: 'Electric glow', price: 100,
    previewColor: '#39ff14',
    drawCell(ctx, x, y, sz, hex, cr) {
      ctx.save();
      _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = '#050d05'; ctx.fill();
      ctx.shadowColor = hex; ctx.shadowBlur = 14;
      ctx.strokeStyle = hex; ctx.lineWidth = 2;
      _rr(ctx, x+1, y+1, sz-2, sz-2, cr); ctx.stroke();
      ctx.shadowBlur = 6;
      ctx.strokeStyle = _lighten(hex, .4); ctx.lineWidth = 1;
      _rr(ctx, x+3, y+3, sz-6, sz-6, cr); ctx.stroke();
      ctx.restore();
    }
  },
  {
    id: 'pastel', name: 'Pastel', desc: 'Soft dreamy colors', price: 100,
    previewColor: '#ffb3d9',
    drawCell(ctx, x, y, sz, hex, cr) {
      const soft = _pastel(hex);
      const g = ctx.createLinearGradient(x, y, x+sz, y+sz);
      g.addColorStop(0, _lighten(soft, .35)); g.addColorStop(1, soft);
      _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      _rr(ctx, x+3, y+3, sz-6, Math.max(4, sz*0.28), 3); ctx.fill();
    }
  },
  {
    id: 'darkheart', name: 'Dark Heart', desc: 'Sweet but sinister', price: 100,
    drawCell(ctx, x, y, sz, hex, cr) {
      // Dark candy base
      _rr(ctx, x, y, sz, sz, cr);
      ctx.fillStyle = '#0e0610'; ctx.fill();
      // Candy color layer using hex
      ctx.save();
      _rr(ctx, x, y, sz, sz, cr); ctx.clip();
      const g = ctx.createLinearGradient(x, y, x, y + sz);
      g.addColorStop(0, hex + 'dd'); g.addColorStop(0.5, hex + '88'); g.addColorStop(1, hex + 'bb');
      ctx.fillStyle = g; ctx.fill();
      // Diagonal candy stripes
      ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 3;
      for (let i = -sz; i < sz * 2; i += 9) {
        ctx.beginPath(); ctx.moveTo(x + i, y + sz); ctx.lineTo(x + i + sz, y); ctx.stroke();
      }
      ctx.restore();
      // Mini heart
      const cx = x + sz * 0.5, cy = y + sz * 0.52, hs = sz * 0.19;
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(cx, cy + hs);
      ctx.bezierCurveTo(cx - hs * 1.4, cy + hs * 0.1, cx - hs * 1.6, cy - hs * 0.6, cx, cy - hs * 0.3);
      ctx.bezierCurveTo(cx + hs * 1.6, cy - hs * 0.6, cx + hs * 1.4, cy + hs * 0.1, cx, cy + hs);
      ctx.fill(); ctx.restore();
      // Top gloss
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      _rr(ctx, x + 3, y + 3, sz - 6, Math.max(4, sz * 0.24), 2); ctx.fill();
    }
  },
  {
    id: 'obsidian', name: 'Obsidian', desc: 'Volcanic dark glass', price: 100,
    drawCell(ctx, x, y, sz, hex, cr) {
      // Very dark base
      _rr(ctx, x, y, sz, sz, cr);
      const g = ctx.createLinearGradient(x, y, x + sz, y + sz);
      g.addColorStop(0, '#0d0d12'); g.addColorStop(1, '#050508');
      ctx.fillStyle = g; ctx.fill();
      // Crystal facets using hex
      ctx.save();
      _rr(ctx, x, y, sz, sz, cr); ctx.clip();
      ctx.fillStyle = hex + '36';
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + sz * 0.7, y); ctx.lineTo(x + sz * 0.4, y + sz * 0.55);
      ctx.lineTo(x, y + sz * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = hex + '22';
      ctx.beginPath();
      ctx.moveTo(x + sz, y + sz); ctx.lineTo(x + sz * 0.3, y + sz); ctx.lineTo(x + sz * 0.6, y + sz * 0.45);
      ctx.lineTo(x + sz, y + sz * 0.7); ctx.closePath(); ctx.fill();
      ctx.restore();
      // Hex glow border
      ctx.save();
      ctx.shadowColor = hex; ctx.shadowBlur = 10;
      ctx.strokeStyle = hex + '99'; ctx.lineWidth = 1.5;
      _rr(ctx, x + 1, y + 1, sz - 2, sz - 2, cr); ctx.stroke();
      ctx.restore();
      // Sharp glint
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(x + sz * 0.14, y + sz * 0.12); ctx.lineTo(x + sz * 0.3, y + sz * 0.12);
      ctx.lineTo(x + sz * 0.18, y + sz * 0.28); ctx.closePath(); ctx.fill();
    }
  },
  {
    id: 'pixel', name: 'Pixel', desc: '8-bit retro', price: 100,
    drawCell(ctx, x, y, sz, hex, _cr) {
      // Intentionally square — no rounded corners for pixel art look
      ctx.fillStyle = hex; ctx.fillRect(x, y, sz, sz);
      const bw = Math.max(2, Math.floor(sz * 0.14));
      // Top / left highlight
      ctx.fillStyle = _lighten(hex, 0.38);
      ctx.fillRect(x, y, sz, bw);
      ctx.fillRect(x, y, bw, sz);
      // Bottom / right shadow
      ctx.fillStyle = _darken(hex, 0.35);
      ctx.fillRect(x, y + sz - bw, sz, bw);
      ctx.fillRect(x + sz - bw, y, bw, sz);
      // Inner face
      ctx.fillStyle = _lighten(hex, 0.12);
      ctx.fillRect(x + bw, y + bw, sz - bw * 2, sz - bw * 2);
    }
  },
  {
    id: 'shadow', name: 'Shadow', desc: 'Dark & mysterious', price: 100,
    previewColor: '#4a4a6a',
    drawCell(ctx, x, y, sz, hex, cr) {
      const g = ctx.createLinearGradient(x, y, x+sz, y+sz);
      g.addColorStop(0, '#18182e'); g.addColorStop(1, _darken(hex, .35));
      _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = hex + '55'; ctx.lineWidth = 1.5;
      _rr(ctx, x+1, y+1, sz-2, sz-2, cr); ctx.stroke();
      ctx.fillStyle = hex + '22';
      _rr(ctx, x+4, y+4, sz-8, Math.max(4, sz*0.22), 2); ctx.fill();
    }
  },
  {
    id: 'candy', name: 'Candy', desc: 'Sweet & colorful', price: 100,
    previewColor: '#ff69b4',
    drawCell(ctx, x, y, sz, hex, cr) {
      _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = hex; ctx.fill();
      ctx.save();
      _rr(ctx, x, y, sz, sz, cr); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (let i = -sz; i < sz*2; i += 10) ctx.fillRect(x+i, y, 5, sz*2);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      _rr(ctx, x+3, y+3, sz-6, Math.max(4, sz*0.28), 2); ctx.fill();
    }
  },
  {
    id: 'galaxy', name: 'Galaxy', desc: 'Cosmic starfield', price: 100,
    previewColor: '#6622cc',
    drawCell(ctx, x, y, sz, hex, cr) {
      const g = ctx.createLinearGradient(x, y, x+sz, y+sz);
      g.addColorStop(0, _darken(hex, 0.82)); g.addColorStop(.5, _darken(hex, 0.55)); g.addColorStop(1, _darken(hex, 0.78));
      _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = g; ctx.fill();
      ctx.save();
      _rr(ctx, x, y, sz, sz, cr); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const dots = [[.15,.2],[.7,.1],[.45,.6],[.82,.52],[.28,.78],[.6,.34]];
      for (const [dx,dy] of dots)
        ctx.fillRect(Math.round(x+dx*sz), Math.round(y+dy*sz), 1.5, 1.5);
      ctx.restore();
      ctx.strokeStyle = hex + '55'; ctx.lineWidth = 1;
      _rr(ctx, x+1, y+1, sz-2, sz-2, cr); ctx.stroke();
    }
  },
  {
    id: 'matrix', name: 'Matrix', desc: 'Enter the grid', price: 100,
    previewColor: '#00ff41',
    drawCell(ctx, x, y, sz, hex, cr) {
      _rr(ctx, x, y, sz, sz, cr); ctx.fillStyle = _darken(hex, 0.88); ctx.fill();
      ctx.save();
      _rr(ctx, x, y, sz, sz, cr); ctx.clip();
      const fs = Math.max(7, Math.floor(sz * .32));
      ctx.font = `${fs}px monospace`; ctx.textBaseline = 'top';
      const px = Math.round(x), py = Math.round(y);
      const seed = ((px >> 2) * 3 + (py >> 2) * 7);
      ctx.fillStyle = hex + 'bf';
      ctx.fillText('01'.charAt(seed % 2), px + sz*.15, py + sz*.1);
      ctx.fillStyle = hex + '66';
      ctx.fillText('01'.charAt((seed+1) % 2), px + sz*.55, py + sz*.52);
      ctx.restore();
      ctx.save();
      ctx.shadowColor = hex; ctx.shadowBlur = 8;
      ctx.strokeStyle = hex + '80'; ctx.lineWidth = 1;
      _rr(ctx, x+.5, y+.5, sz-1, sz-1, cr); ctx.stroke();
      ctx.restore();
    }
  }
];

// ─── Economy Store ────────────────────────────────────────────────────────────

const ECONOMY_KEY = 'weaverEconomy';

export class EconomyStore {
  constructor() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(ECONOMY_KEY) || '{}'); } catch {}
    this.coins        = data.coins        ?? 0;
    this.unlockedIds  = new Set(data.unlockedIds ?? ['classic']);
    this.activeSkinId = data.activeSkinId ?? 'classic';
    this.unlockedIds.add('classic'); // always free
  }

  _save() {
    localStorage.setItem(ECONOMY_KEY, JSON.stringify({
      coins:        this.coins,
      unlockedIds:  [...this.unlockedIds],
      activeSkinId: this.activeSkinId,
    }));
  }

  addCoins(n) { this.coins += n; this._save(); }

  /**
   * Buy a random locked skin.
   * Returns { type: 'bought', skin } | { type: 'noCoins' } | { type: 'allOwned' }
   */
  buyRandom() {
    const locked = SKINS.filter(s => s.price > 0 && !this.unlockedIds.has(s.id));
    if (!locked.length)   return { type: 'allOwned' };
    if (this.coins < 100) return { type: 'noCoins' };
    this.coins -= 100;
    const skin = locked[Math.floor(Math.random() * locked.length)];
    this.unlockedIds.add(skin.id);
    this.activeSkinId = skin.id;
    this._save();
    return { type: 'bought', skin };
  }

  setActive(skinId) {
    if (!this.unlockedIds.has(skinId)) return false;
    this.activeSkinId = skinId;
    this._save();
    return true;
  }

  getActiveSkin() {
    return SKINS.find(s => s.id === this.activeSkinId) ?? SKINS[0];
  }
}
