/**
 * score.js — Scoring system with combo multiplier.
 *
 * Formula:
 *   Score = deletedBlocks × BASE_POINTS_PER_BLOCK × comboFactor
 *   comboFactor = 1 + (comboMultiplier - 1) × COMBO_STEP_PER_BLOCK / BASE_POINTS_PER_BLOCK
 *
 * Special combo labels:
 *   "Mega Weaver"  — same move clears both a row/col AND a color cluster
 *   "Line Blaster" — at least one row+col cleared simultaneously
 *   "Color Burst"  — only color cluster cleared (no line)
 */

const BASE_POINTS_PER_BLOCK = 12;
const COMBO_STEP_PER_BLOCK = 3;

export class ScoreSystem {
  constructor() {
    this.score          = 0;
    this.best           = Number(localStorage.getItem('weaverBest') ?? 0);
    this.comboMultiplier= 1;
    this._lastMoveTime  = 0;
    this._listeners     = [];
  }

  onChange(fn) { this._listeners.push(fn); }
  _emit()      { for (const fn of this._listeners) fn(this); }

  /**
   * Records a clearing event and computes the score delta.
   *
   * @param {Object} params
   * @param {number} params.deletedBlocks    total cells cleared
   * @param {number} params.clearedRows      number of full rows cleared
   * @param {number} params.clearedCols      number of full cols cleared
   * @param {number} params.colorClusters    number of color clusters popped
   * @param {number} params.now              performance.now() timestamp
   * @returns {{ delta: number, label: string|null }}
   */
  record({ deletedBlocks, clearedRows, clearedCols, colorClusters, now }) {
    this._lastMoveTime = now;

    const hasClear   = clearedRows + clearedCols > 0;
    const hasCluster = colorClusters > 0;

    // Determine event label
    let label = null;
    if (hasClear && hasCluster) label = 'MEGA WEAVER!';
    else if (clearedRows > 0 && clearedCols > 0) label = 'LINE BLASTER!';
    else if (hasClear)  label = 'LINE CLEAR!';
    else if (hasCluster) label = 'COLOR BURST!';

    const comboFactor = 1 + (Math.max(0, this.comboMultiplier - 1) * COMBO_STEP_PER_BLOCK) / BASE_POINTS_PER_BLOCK;
    const delta = deletedBlocks * BASE_POINTS_PER_BLOCK * comboFactor;

    this.score += Math.round(delta);

    // Increment combo for next move
    this.comboMultiplier = Math.min(this.comboMultiplier + 1, 10);

    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('weaverBest', this.best);
    }

    this._emit();
    return { delta: Math.round(delta), label };
  }

  breakCombo() {
    if (this.comboMultiplier === 1) return;
    this.comboMultiplier = 1;
    this._emit();
  }

  reset() {
    this.score           = 0;
    this.comboMultiplier = 1;
    this._lastMoveTime   = 0;
    this._emit();
  }
}
