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
    nameKey: 'pu_blast_right_name',
    icon: '➡️',
    descKey: 'pu_blast_right_desc',
    price: 30,
  },
  {
    id: 'blast_left',
    nameKey: 'pu_blast_left_name',
    icon: '⬅️',
    descKey: 'pu_blast_left_desc',
    price: 30,
  },
  {
    id: 'smash',
    nameKey: 'pu_smash_name',
    icon: '💥',
    descKey: 'pu_smash_desc',
    price: 20,
  },
  {
    id: 'color_bomb',
    nameKey: 'pu_color_bomb_name',
    icon: '🌈',
    descKey: 'pu_color_bomb_desc',
    price: 60,
  },
  {
    id: 'extra_block',
    nameKey: 'pu_extra_block_name',
    icon: '➕',
    descKey: 'pu_extra_block_desc',
    price: 40,
  },
    {
      id: 'rotate_block',
      nameKey: 'pu_rotate_block_name',
      icon: '🔄',
      descKey: 'pu_rotate_block_desc',
      price: 35,
    },
    {
      id: 'undo_move',
      nameKey: 'pu_undo_move_name',
      icon: '↩️',
      descKey: 'pu_undo_move_desc',
      price: 45,
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
