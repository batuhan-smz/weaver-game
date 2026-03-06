/**
 * blocks.js — Block shape definitions, generation, and weighted-random selection.
 *
 * A Block is a description of which cells (relative to an anchor at 0,0) it fills,
 * plus a colorID.  It is immutable after creation.
 */

// ─── Color Palette ────────────────────────────────────────────────────────────

export const COLORS = {
  1: { name: 'Crimson',  hex: '#ef4444' },
  2: { name: 'Amber',    hex: '#f59e0b' },
  3: { name: 'Lime',     hex: '#84cc16' },
  4: { name: 'Cyan',     hex: '#22d3ee' },
  5: { name: 'Violet',   hex: '#a78bfa' },
  6: { name: 'Pink',     hex: '#f472b6' },
  7: { name: 'Sky',      hex: '#38bdf8' },
  8: { name: 'Emerald',  hex: '#34d399' },
};
export const COLOR_COUNT = Object.keys(COLORS).length;

// ─── Shape Library ────────────────────────────────────────────────────────────
// Each shape is an array of [dRow, dCol] offsets from position (0,0).

export const SHAPES = {
  // 1-cell
  DOT:     { cells: [[0,0]],                       size: 1 },

  // 2-cell
  H2:      { cells: [[0,0],[0,1]],                  size: 2 },
  V2:      { cells: [[0,0],[1,0]],                  size: 2 },

  // 3-cell
  H3:      { cells: [[0,0],[0,1],[0,2]],             size: 3 },
  V3:      { cells: [[0,0],[1,0],[2,0]],             size: 3 },
  L3:      { cells: [[0,0],[1,0],[1,1]],             size: 3 },
  J3:      { cells: [[0,1],[1,0],[1,1]],             size: 3 },

  // 4-cell
  H4:      { cells: [[0,0],[0,1],[0,2],[0,3]],       size: 4 },
  V4:      { cells: [[0,0],[1,0],[2,0],[3,0]],       size: 4 },
  SQ:      { cells: [[0,0],[0,1],[1,0],[1,1]],       size: 4 }, // square
  L4:      { cells: [[0,0],[1,0],[2,0],[2,1]],       size: 4 },
  J4:      { cells: [[0,1],[1,1],[2,0],[2,1]],       size: 4 },
  S4:      { cells: [[0,1],[0,2],[1,0],[1,1]],       size: 4 },
  Z4:      { cells: [[0,0],[0,1],[1,1],[1,2]],       size: 4 },
  T4:      { cells: [[0,0],[0,1],[0,2],[1,1]],       size: 4 },

  // 5-cell
  PLUS:    { cells: [[0,1],[1,0],[1,1],[1,2],[2,1]], size: 5 },
  H5:      { cells: [[0,0],[0,1],[0,2],[0,3],[0,4]],size: 5 },
  V5:      { cells: [[0,0],[1,0],[2,0],[3,0],[4,0]],size: 5 },
};

export const SHAPE_KEYS = Object.keys(SHAPES);

// ─── Block class ──────────────────────────────────────────────────────────────

let _blockIDCounter = 0;

export class Block {
  /**
   * @param {string} shapeKey  key from SHAPES
   * @param {number} colorID   1-8
   */
  constructor(shapeKey, colorID) {
    this.id       = `blk_${++_blockIDCounter}`;
    this.shapeKey = shapeKey;
    this.colorID  = colorID;
    /** @type {[number,number][]}  relative [row,col] offsets */
    this.cells    = SHAPES[shapeKey].cells;
    this.size     = SHAPES[shapeKey].size;
  }

  /**
   * Returns absolute grid positions when block anchor is at (anchorRow, anchorCol).
   */
  getAbsolutePositions(anchorRow, anchorCol) {
    return this.cells.map(([dr, dc]) => ({
      row: anchorRow + dr,
      col: anchorCol + dc,
    }));
  }

  /**
   * Bounding box of the shape (rows × cols), used for canvas preview scaling.
   */
  getBoundingBox() {
    const rows = this.cells.map(([r]) => r);
    const cols = this.cells.map(([, c]) => c);
    return {
      rows: Math.max(...rows) + 1,
      cols: Math.max(...cols) + 1,
    };
  }
}

// ─── Weighted Random Helpers ──────────────────────────────────────────────────

function weightedChoice(options) {
  // options = [{value, weight}, ...]
  const total = options.reduce((s, o) => s + o.weight, 0);
  let roll    = Math.random() * total;
  for (const o of options) {
    roll -= o.weight;
    if (roll <= 0) return o.value;
  }
  return options.at(-1).value;
}

/**
 * Analyses the grid's empty-cell layout to bias shape selection.
 *
 * @param {import('./grid.js').Grid} grid
 * @returns {Object}  shapeKey → weight multiplier
 */
function analyseGrid(grid) {
  const SIZE = 10;
  const bias = {};

  // Count 2×2 empty squares — favours SQ and L/J shapes
  let sq2Count = 0;
  for (let r = 0; r < SIZE - 1; r++)
    for (let c = 0; c < SIZE - 1; c++)
      if (
        grid.isEmpty(r,c) && grid.isEmpty(r,c+1) &&
        grid.isEmpty(r+1,c) && grid.isEmpty(r+1,c+1)
      ) sq2Count++;

  if (sq2Count > 4) {
    bias.SQ  = 2.0;
    bias.L4  = 1.5;
    bias.J4  = 1.5;
    bias.L3  = 1.4;
    bias.J3  = 1.4;
  }

  // Count long horizontal strips
  let hStrip = 0;
  for (let r = 0; r < SIZE; r++) {
    let run = 0;
    for (let c = 0; c < SIZE; c++) {
      run = grid.isEmpty(r, c) ? run + 1 : 0;
      if (run >= 4) hStrip++;
    }
  }
  if (hStrip > 3)  { bias.H4 = 1.8; bias.H3 = 1.6; bias.H5 = 1.4; }

  // Count long vertical strips
  let vStrip = 0;
  for (let c = 0; c < SIZE; c++) {
    let run = 0;
    for (let r = 0; r < SIZE; r++) {
      run = grid.isEmpty(r, c) ? run + 1 : 0;
      if (run >= 4) vStrip++;
    }
  }
  if (vStrip > 3)  { bias.V4 = 1.8; bias.V3 = 1.6; bias.V5 = 1.4; }

  return bias;
}

/**
 * Picks a colorID biased toward under-represented colors on the grid,
 * with an extra nudge if placing that color might complete a 6-cluster.
 *
 * @param {import('./grid.js').Grid} grid
 * @param {number[]} handColors  colorIDs already in the current tray
 */
function pickColor(grid, handColors) {
  const counts = Array(COLOR_COUNT + 1).fill(0); // index 0 unused
  for (const { row, col } of grid.getFilledCells())
    counts[grid.get(row, col).colorID]++;

  // Find dominant colour on grid that is close to a 6-cluster
  let bonusColor = 0;
  for (let cid = 1; cid <= COLOR_COUNT; cid++) {
    // Quick 2-BFS scan: any cluster of 4 or 5?
    const SIZE = 10;
    const visited = new Set();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = grid.get(r, c);
        if (!cell || cell.isEmpty || cell.colorID !== cid) continue;
        const k = `${r},${c}`;
        if (visited.has(k)) continue;
        const cluster = grid.getColorCluster(r, c);
        for (const p of cluster) visited.add(`${p.row},${p.col}`);
        if (cluster.length >= 4 && cluster.length < 6) {
          bonusColor = cid;
        }
      }
    }
  }

  const options = [];
  for (let cid = 1; cid <= COLOR_COUNT; cid++) {
    let w = 1 / (counts[cid] + 1); // fewer on board → higher base weight
    if (cid === bonusColor) w *= 3; // strong bonus if close to cluster
    // Avoid giving same 4 colors in hand
    if (handColors.filter(c => c === cid).length >= 2) w *= 0.3;
    options.push({ value: cid, weight: w });
  }

  return weightedChoice(options);
}

/**
 * Generates a tray of `count` blocks using weighted randomness.
 *
 * @param {import('./grid.js').Grid} grid
 * @param {number} count   number of blocks per tray (default 4)
 * @param {boolean} hard   if true, force-include at least one awkward piece
 * @returns {Block[]}
 */
export function generateTray(grid, count = 4, hard = false) {
  const shapeBias = analyseGrid(grid);
  const blocks    = [];
  const handColors= [];

  for (let i = 0; i < count; i++) {
    // Shape selection
    let shapeOptions;
    if (hard && i === count - 1) {
      // Deliberately awkward: long line or plus that is hard to fit
      shapeOptions = [
        { value: 'H5', weight: 1 },
        { value: 'V5', weight: 1 },
        { value: 'PLUS', weight: 1 },
      ];
    } else {
      shapeOptions = SHAPE_KEYS.map(key => ({
        value: key,
        weight: (shapeBias[key] ?? 1) * (SHAPES[key].size <= 3 ? 0.8 : 1.2),
      }));
    }

    const shapeKey = weightedChoice(shapeOptions);
    const colorID  = pickColor(grid, handColors);
    handColors.push(colorID);
    blocks.push(new Block(shapeKey, colorID));
  }

  return blocks;
}
