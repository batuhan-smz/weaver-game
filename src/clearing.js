/**
 * clearing.js — Row/column clearing + BFS color-cluster clearing.
 *
 * Returns a detailed result object so the score system and
 * particle system know exactly what was cleared and where.
 */

import { Grid } from './grid.js';

const CLUSTER_MIN = 10; // minimum connected same-color cells to pop

/**
 * After placing a block at `placedPositions`, run all clearing logic.
 *
 * @param {Grid} grid
 * @param {{ row:number, col:number }[]} placedPositions
 * @returns {{
 *   cleared: { row:number, col:number }[],
 *   clearedRows: number[],
 *   clearedCols: number[],
 *   colorClusters: { row:number, col:number }[][],
 *   totalCleared: number
 * }}
 */
export function runClearingLogic(grid, placedPositions) {
  const toRemove = new Set(); // "row,col" keys
  const key = (r, c) => `${r},${c}`;

  // ── 1. Row / Column clearing ──────────────────────────────────────────────
  const clearedRows = grid.getFullRows();
  const clearedCols = grid.getFullCols();

  for (const row of clearedRows)
    for (let c = 0; c < Grid.SIZE; c++) toRemove.add(key(row, c));

  for (const col of clearedCols)
    for (let r = 0; r < Grid.SIZE; r++) toRemove.add(key(r, col));

  // ── 2. BFS color-cluster clearing ────────────────────────────────────────
  //    We seed the BFS from every placed cell (and their neighbours that
  //    share coulour) to avoid missing clusters bridged by the new block.
  const seedSet = new Set();
  for (const { row, col } of placedPositions) {
    seedSet.add(key(row, col));
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = row + dr, nc = col + dc;
      if (grid.isInBounds(nr, nc) && !grid.get(nr, nc).isEmpty)
        seedSet.add(key(nr, nc));
    }
  }

  const seeds = [...seedSet].map(k => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  });

  const colorClusters = [];
  const checkedForCluster = new Set();

  for (const { row, col } of seeds) {
    const k = key(row, col);
    if (checkedForCluster.has(k)) continue;

    const cell = grid.get(row, col);
    if (!cell || cell.isEmpty) continue;

    const cluster = grid.getColorCluster(row, col);
    for (const p of cluster) checkedForCluster.add(key(p.row, p.col));

    if (cluster.length >= CLUSTER_MIN) {
      colorClusters.push(cluster);
      for (const p of cluster) toRemove.add(key(p.row, p.col));
    }
  }

  // ── 3. Commit removals ────────────────────────────────────────────────────
  const clearedPositions = [...toRemove].map(k => {
    const [r, c] = k.split(',').map(Number);
    return { row: r, col: c };
  });

  if (clearedPositions.length > 0) {
    grid.clearMany(clearedPositions);
  }

  return {
    cleared:       clearedPositions,
    clearedRows,
    clearedCols,
    colorClusters,
    totalCleared:  clearedPositions.length,
  };
}
