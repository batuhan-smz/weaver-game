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

  // 6 / 9-cell (early score acceleration)
  RECT23H: { cells: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]], size: 6 },
  RECT23V: { cells: [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]], size: 6 },
  RECT33:  { cells: [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]], size: 9 },
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

function _countShapeFits(grid, shapeKey) {
  const shape = SHAPES[shapeKey];
  if (!shape) return 0;
  let fitCount = 0;
  const maxR = 8 - (Math.max(...shape.cells.map(([r]) => r)) + 1);
  const maxC = 8 - (Math.max(...shape.cells.map(([, c]) => c)) + 1);
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      const positions = shape.cells.map(([dr, dc]) => ({ row: r + dr, col: c + dc }));
      if (grid.canPlace(positions)) fitCount++;
    }
  }
  return fitCount;
}

function _collectLineNeeds(grid) {
  const SIZE = 8;
  const rowFilled = Array(SIZE).fill(0);
  const colFilled = Array(SIZE).fill(0);

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid.isEmpty(r, c)) {
        rowFilled[r]++;
        colFilled[c]++;
      }
    }
  }

  const rowNeedWeight = rowFilled.map(v => {
    const empty = SIZE - v;
    if (empty <= 0 || empty > 5) return 0;
    if (empty === 1) return 14;
    if (empty === 2) return 10;
    if (empty === 3) return 7;
    if (empty === 4) return 4;
    return 2;
  });

  const colNeedWeight = colFilled.map(v => {
    const empty = SIZE - v;
    if (empty <= 0 || empty > 5) return 0;
    if (empty === 1) return 14;
    if (empty === 2) return 10;
    if (empty === 3) return 7;
    if (empty === 4) return 4;
    return 2;
  });

  return { rowFilled, colFilled, rowNeedWeight, colNeedWeight };
}

function _shapePlacementStats(grid, shapeKey, needs) {
  const shape = SHAPES[shapeKey];
  if (!shape) return { fitCount: 0, bestNeedScore: 0, bestClears: 0 };

  const SIZE = 8;
  const maxR = SIZE - (Math.max(...shape.cells.map(([r]) => r)) + 1);
  const maxC = SIZE - (Math.max(...shape.cells.map(([, c]) => c)) + 1);
  const { rowFilled, colFilled, rowNeedWeight, colNeedWeight } = needs;

  let fitCount = 0;
  let bestNeedScore = 0;
  let bestClears = 0;

  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      const positions = shape.cells.map(([dr, dc]) => ({ row: r + dr, col: c + dc }));
      if (!grid.canPlace(positions)) continue;
      fitCount++;

      const addRow = Array(SIZE).fill(0);
      const addCol = Array(SIZE).fill(0);
      let needScore = 0;

      for (const p of positions) {
        addRow[p.row]++;
        addCol[p.col]++;
        needScore += rowNeedWeight[p.row] + colNeedWeight[p.col];
      }

      let clears = 0;
      for (let rr = 0; rr < SIZE; rr++)
        if (addRow[rr] > 0 && rowFilled[rr] + addRow[rr] === SIZE) clears++;
      for (let cc = 0; cc < SIZE; cc++)
        if (addCol[cc] > 0 && colFilled[cc] + addCol[cc] === SIZE) clears++;

      needScore += clears * 28;
      needScore += shape.size * 0.4;

      if (needScore > bestNeedScore) bestNeedScore = needScore;
      if (clears > bestClears) bestClears = clears;
    }
  }

  return { fitCount, bestNeedScore, bestClears };
}

/**
 * Analyses the grid's empty-cell layout to bias shape selection.
 *
 * @param {import('./grid.js').Grid} grid
 * @returns {Object}  shapeKey → weight multiplier
 */
function analyseGrid(grid) {
  const SIZE = 8;
  const bias = {};

  // Count 2×2 empty squares — favours SQ and L/J shapes
  let sq2Count = 0;
  for (let r = 0; r < SIZE - 1; r++)
    for (let c = 0; c < SIZE - 1; c++)
      if (
        grid.isEmpty(r,c) && grid.isEmpty(r,c+1) &&
        grid.isEmpty(r+1,c) && grid.isEmpty(r+1,c+1)
      ) sq2Count++;

  if (sq2Count > 2) {
    bias.SQ  = 2.0;
    bias.L4  = 1.5;
    bias.J4  = 1.5;
    bias.L3  = 1.4;
    bias.J3  = 1.4;
  }

  // Count 2x3 and 3x3 empty zones — favours large rectangles in early game
  let rect23h = 0;
  let rect23v = 0;
  let rect33 = 0;
  for (let r = 0; r < SIZE - 1; r++) {
    for (let c = 0; c < SIZE - 2; c++) {
      const ok =
        grid.isEmpty(r, c) && grid.isEmpty(r, c + 1) && grid.isEmpty(r, c + 2) &&
        grid.isEmpty(r + 1, c) && grid.isEmpty(r + 1, c + 1) && grid.isEmpty(r + 1, c + 2);
      if (ok) rect23h++;
    }
  }
  for (let r = 0; r < SIZE - 2; r++) {
    for (let c = 0; c < SIZE - 1; c++) {
      const ok =
        grid.isEmpty(r, c) && grid.isEmpty(r + 1, c) && grid.isEmpty(r + 2, c) &&
        grid.isEmpty(r, c + 1) && grid.isEmpty(r + 1, c + 1) && grid.isEmpty(r + 2, c + 1);
      if (ok) rect23v++;
    }
  }
  for (let r = 0; r < SIZE - 2; r++) {
    for (let c = 0; c < SIZE - 2; c++) {
      const ok =
        grid.isEmpty(r, c) && grid.isEmpty(r, c + 1) && grid.isEmpty(r, c + 2) &&
        grid.isEmpty(r + 1, c) && grid.isEmpty(r + 1, c + 1) && grid.isEmpty(r + 1, c + 2) &&
        grid.isEmpty(r + 2, c) && grid.isEmpty(r + 2, c + 1) && grid.isEmpty(r + 2, c + 2);
      if (ok) rect33++;
    }
  }
  if (rect23h > 0) bias.RECT23H = 1.35;
  if (rect23v > 0) bias.RECT23V = 1.35;
  if (rect33 > 0)  bias.RECT33 = 1.15;

  // Count long horizontal strips
  let hStrip = 0;
  for (let r = 0; r < SIZE; r++) {
    let run = 0;
    for (let c = 0; c < SIZE; c++) {
      run = grid.isEmpty(r, c) ? run + 1 : 0;
      if (run >= 4) hStrip++;
    }
  }
  if (hStrip > 2)  { bias.H4 = 1.8; bias.H3 = 1.6; bias.H5 = 1.4; }

  // Count long vertical strips
  let vStrip = 0;
  for (let c = 0; c < SIZE; c++) {
    let run = 0;
    for (let r = 0; r < SIZE; r++) {
      run = grid.isEmpty(r, c) ? run + 1 : 0;
      if (run >= 4) vStrip++;
    }
  }
  if (vStrip > 2)  { bias.V4 = 1.8; bias.V3 = 1.6; bias.V5 = 1.4; }

  return bias;
}

/**
 * Picks a colorID biased toward under-represented colors on the grid,
 * with an extra nudge if placing that color might complete a 6-cluster.
 *
 * @param {import('./grid.js').Grid} grid
 * @param {number[]} handColors  colorIDs already in the current tray
 */
function pickColor(grid, handColors, maxColor = COLOR_COUNT) {
  const counts = Array(COLOR_COUNT + 1).fill(0); // index 0 unused
  for (const { row, col } of grid.getFilledCells())
    counts[grid.get(row, col).colorID]++;

  // Find dominant colour on grid that is close to a 6-cluster
  let bonusColor = 0;
  for (let cid = 1; cid <= maxColor; cid++) {
    // Quick 2-BFS scan: any cluster of 3 or 4?
    const SIZE = 8;
    const visited = new Set();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = grid.get(r, c);
        if (!cell || cell.isEmpty || cell.colorID !== cid) continue;
        const k = `${r},${c}`;
        if (visited.has(k)) continue;
        const cluster = grid.getColorCluster(r, c);
        for (const p of cluster) visited.add(`${p.row},${p.col}`);
        if (cluster.length >= 3 && cluster.length < 5) {
          bonusColor = cid;
        }
      }
    }
  }

  const options = [];
  for (let cid = 1; cid <= maxColor; cid++) {
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
export function generateTray(grid, count = 4, hard = false, maxColor = COLOR_COUNT, opts = {}) {
  const smartProfile = opts.smartProfile ?? 'normal'; // early | normal | hard
  const profileAggression = smartProfile === 'early' ? 0.9 : smartProfile === 'hard' ? 0.4 : 0.65;
  const smartAggression = Math.max(0, Math.min(1, Number(opts.smartAggression ?? profileAggression)));
  const shapeBias = analyseGrid(grid);
  const blocks    = [];
  const handColors= [];
  const needs = _collectLineNeeds(grid);
  const statsByShape = Object.fromEntries(SHAPE_KEYS.map(k => [k, _shapePlacementStats(grid, k, needs)]));
  const fitByShape = Object.fromEntries(SHAPE_KEYS.map(k => [k, statsByShape[k]?.fitCount ?? _countShapeFits(grid, k)]));

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
        weight: (() => {
          let w = (shapeBias[key] ?? 1) * (SHAPES[key].size <= 3 ? 0.8 : 1.2);
          const fits = fitByShape[key] ?? 0;
          const needScore = statsByShape[key]?.bestNeedScore ?? 0;
          const clearScore = statsByShape[key]?.bestClears ?? 0;
          if (smartProfile === 'early') {
            // Early game: strongly favour blocks that can complete rows/cols and stay playable.
            w *= Math.max(0.12, fits + 0.2);
            w *= 1 + Math.min(1.25, (needScore / 28) * (0.35 + smartAggression));
            if (clearScore > 0) w *= 1 + clearScore * (0.28 + smartAggression * 0.6);
            if (SHAPES[key].size <= 3) w *= 1.3;
            if (key === 'RECT23H' || key === 'RECT23V') w *= (1.25 + smartAggression * 0.45);
            if (key === 'RECT33') w *= (1.05 + smartAggression * 0.4);
            if (SHAPES[key].size >= 5 && key !== 'RECT23H' && key !== 'RECT23V' && key !== 'RECT33') w *= 0.62;
          } else {
            // Later stages still prefer placeable and line-completing options.
            w *= Math.max(0.2, 0.6 + fits * 0.35);
            w *= 1 + Math.min(0.8, (needScore / 48) * (0.25 + smartAggression));
            if (clearScore > 0) w *= 1 + clearScore * (0.18 + smartAggression * 0.35);
          }
          return w;
        })(),
      }));
    }

    const shapeKey = weightedChoice(shapeOptions);
    const colorID  = pickColor(grid, handColors, maxColor);
    handColors.push(colorID);
    blocks.push(new Block(shapeKey, colorID));
  }

  // Guarantee at least one immediately playable block in tray.
  const anyPlayable = blocks.some(b => (fitByShape[b.shapeKey] ?? 0) > 0);
  if (!anyPlayable) {
    const playableKey = SHAPE_KEYS
      .filter(k => (fitByShape[k] ?? 0) > 0)
      .sort((a, b) => (fitByShape[b] ?? 0) - (fitByShape[a] ?? 0))[0];
    if (playableKey) blocks[0] = new Block(playableKey, pickColor(grid, [], maxColor));
  }

  // Smart profile: if possible, guarantee a shape that can immediately clear a row/column.
  const lineClearKey = SHAPE_KEYS
    .filter(k => (statsByShape[k]?.bestClears ?? 0) > 0)
    .sort((a, b) => (statsByShape[b]?.bestClears ?? 0) - (statsByShape[a]?.bestClears ?? 0))[0];
  const guaranteeLineClear = lineClearKey && (smartAggression >= 0.42 || smartProfile === 'early');
  if (guaranteeLineClear) {
    const alreadyHasClear = blocks.some(b => (statsByShape[b.shapeKey]?.bestClears ?? 0) > 0);
    if (!alreadyHasClear) {
      const replaceIdx = smartProfile === 'early' ? 1 : (count - 1);
      blocks[replaceIdx] = new Block(lineClearKey, pickColor(grid, handColors, maxColor));
    }
  }

  // Early mode target: at least two playable choices to reduce dead starts.
  if (smartProfile === 'early' && smartAggression >= 0.45) {
    const playableNow = blocks.filter(b => (fitByShape[b.shapeKey] ?? 0) > 0).length;
    if (playableNow < 2) {
      const keys = SHAPE_KEYS
        .filter(k => (fitByShape[k] ?? 0) > 0)
        .sort((a, b) => (fitByShape[b] ?? 0) - (fitByShape[a] ?? 0));
      if (keys[0]) blocks[count - 1] = new Block(keys[0], pickColor(grid, [], maxColor));
    }
  }

  return blocks;
}
