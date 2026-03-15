/**
 * market.js — Power-up definitions and MarketStore.
 *
 * Power-ups:
 *   blast_right  — Clears entire row to the right of a chosen cell (30 🪙)
 *   blast_left   — Clears entire row to the left of a chosen cell  (30 🪙)
 *   smash        — Destroys a single block you tap               (20 🪙)
 *   color_bomb   — Clears all cells of the most frequent color   (60 🪙)
 *   extra_block  — Adds one extra block to current tray          (40 🪙)
 */

export const POWERUPS = [
  {
    id: 'blast_right',
    name: 'Right Blast',
    icon: '➡️',
    desc: 'Clears all cells to the right in a row',
    price: 30,
  },
  {
    id: 'blast_left',
    name: 'Left Blast',
    icon: '⬅️',
    desc: 'Clears all cells to the left in a row',
    price: 30,
  },
  {
    id: 'smash',
    name: 'Block Smash',
    icon: '💥',
    desc: 'Tap any filled cell to destroy it',
    price: 20,
  },
  {
    id: 'color_bomb',
    name: 'Color Bomb',
    icon: '🌈',
    desc: 'Wipes all cells of the most common color',
    price: 60,
  },
  {
    id: 'extra_block',
    name: 'Extra Block',
    icon: '➕',
    desc: 'Adds one more block to your current tray',
    price: 40,
  },
    {
      id: 'rotate_block',
      name: 'Block Rotate',
      icon: '🔄',
      desc: 'Rotate one tray block left/right before placing',
      price: 35,
    },
];

const MARKET_KEY = 'weaverMarket';

export class MarketStore {
  constructor() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(MARKET_KEY) || '{}'); } catch {}
    // inventory: powerup id → count
    this._inv = data.inv ?? {};
  }

  _save() {
    localStorage.setItem(MARKET_KEY, JSON.stringify({ inv: this._inv }));
  }

  count(id) { return this._inv[id] ?? 0; }

  /**
   * Attempt to buy one of a power-up.
   * Returns { type: 'bought' } | { type: 'noCoins' }
   */
  buy(id, economy) {
    const pu = POWERUPS.find(p => p.id === id);
    if (!pu) return { type: 'error' };
    if (economy.coins < pu.price) return { type: 'noCoins' };
    economy.addCoins(-pu.price);
    this._inv[id] = (this._inv[id] ?? 0) + 1;
    this._save();
    return { type: 'bought' };
  }

  use(id) {
    if (!this.count(id)) return false;
    this._inv[id]--;
    this._save();
    return true;
  }
}
