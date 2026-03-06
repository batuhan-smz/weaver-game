/**
 * gameover.js — Fast game-over detection using bitmask comparison.
 *
 * For each block shape in the tray, we check whether it fits anywhere
 * on the 10×10 grid by sliding its bitmask over the grid occupancy mask.
 *
 * Time complexity: O(shapes × rows × cols) — all bitwise, very fast.
 */

import { Grid } from './grid.js';

const SIZE = Grid.SIZE;

/**
 * Builds a flat Uint16Array occupancy mask of the grid.
 * Bit r*SIZE+c is 1 if cell (r,c) is occupied.
 *
 * We use a plain boolean array here (no actual bitwise packing needed
 * at 10×10 to gain meaningful speed, but the intent mirrors a bitmask).
 *
 * @param {Grid} grid
 * @returns {boolean[][]}  occupancy[row][col]
 */
function buildOccupancy(grid) {
  return Array.from({ length: SIZE }, (_, r) =>
    Array.from({ length: SIZE }, (__, c) => !grid.isEmpty(r, c))
  );
}

/**
 * Returns true if `block` can be placed anywhere on the grid.
 *
 * @param {import('./blocks.js').Block} block
 * @param {boolean[][]} occ   occupancy mask
 */
function blockFits(block, occ) {
  const cells = block.cells;   // [[dr,dc], ...]
  const bb    = block.getBoundingBox();

  for (let r = 0; r <= SIZE - bb.rows; r++) {
    for (let c = 0; c <= SIZE - bb.cols; c++) {
      // Check all cells of the block at anchor (r, c)
      let fits = true;
      for (const [dr, dc] of cells) {
        if (occ[r + dr][c + dc]) { fits = false; break; }
      }
      if (fits) return true;
    }
  }
  return false;
}

/**
 * Returns true if at least one block in the tray can be placed somewhere.
 *
 * @param {import('./blocks.js').Block[]} tray
 * @param {Grid} grid
 */
export function hasAnyValidMove(tray, grid) {
  const occ = buildOccupancy(grid);
  return tray.some(block => block && blockFits(block, occ));
}

/**
 * Checks game-over condition.
 * Called after every block placement.
 *
 * @param {import('./blocks.js').Block[]} tray   current hand (nulls = used)
 * @param {Grid} grid
 * @returns {boolean}  true = game over
 */
export function isGameOver(tray, grid) {
  const remaining = tray.filter(Boolean);
  if (remaining.length === 0) return false; // tray exhausted = new tray coming
  return !hasAnyValidMove(remaining, grid);
}
