/**
 * Cell — single unit in the 10×10 grid.
 * Holds identity, color and the block-group it belongs to.
 */
export class Cell {
  constructor() {
    /** @type {boolean} */
    this.isEmpty = true;
    /** @type {number}  0 = empty; 1-8 = color index */
    this.colorID = 0;
    /** @type {string|null} UUID of the placed block that owns this cell */
    this.blockID = null;
  }

  clear() {
    this.isEmpty = true;
    this.colorID = 0;
    this.blockID = null;
  }

  fill(colorID, blockID) {
    this.isEmpty  = false;
    this.colorID  = colorID;
    this.blockID  = blockID;
  }

  clone() {
    const c = new Cell();
    c.isEmpty = this.isEmpty;
    c.colorID = this.colorID;
    c.blockID = this.blockID;
    return c;
  }
}

/**
 * Grid — 8×8 matrix of Cell objects.
 *
 * Observer Pattern:
 *   Instead of scanning the full grid on every frame, mutations are
 *   tracked in a DirtyCells set.  Consumers drain it with `drainDirty()`.
 */
export class Grid {
  static SIZE = 8;

  constructor() {
    /** @type {Cell[][]} */
    this.cells = Array.from({ length: Grid.SIZE }, () =>
      Array.from({ length: Grid.SIZE }, () => new Cell())
    );

    /** @type {Set<string>}  Keys are "row,col" strings */
    this._dirty = new Set();

    /** Registered change listeners  @type {Function[]} */
    this._listeners = [];
  }

  // ─── Observer ──────────────────────────────────────────────────────────────

  onChange(fn) { this._listeners.push(fn); }

  _markDirty(row, col) {
    const key = `${row},${col}`;
    this._dirty.add(key);
  }

  /** Returns dirty indices [{row,col}] and clears the set */
  drainDirty() {
    const result = [];
    for (const key of this._dirty) {
      const [r, c] = key.split(',').map(Number);
      result.push({ row: r, col: c });
    }
    this._dirty.clear();
    return result;
  }

  _emit(changedCells) {
    for (const fn of this._listeners) fn(changedCells);
  }

  // ─── Accessors ─────────────────────────────────────────────────────────────

  get(row, col) {
    return this.cells[row]?.[col] ?? null;
  }

  isInBounds(row, col) {
    return row >= 0 && row < Grid.SIZE && col >= 0 && col < Grid.SIZE;
  }

  isEmpty(row, col) {
    return this.cells[row][col].isEmpty;
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  fill(row, col, colorID, blockID) {
    if (!this.isInBounds(row, col)) return;
    this.cells[row][col].fill(colorID, blockID);
    this._markDirty(row, col);
  }

  clearCell(row, col) {
    if (!this.isInBounds(row, col)) return;
    this.cells[row][col].clear();
    this._markDirty(row, col);
  }

  /** Fills a set of {row,col} positions and fires one observer notification */
  fillMany(positions, colorID, blockID) {
    for (const { row, col } of positions) {
      this.fill(row, col, colorID, blockID);
    }
    const dirty = this.drainDirty();
    this._emit(dirty);
  }

  /** Clears a set of {row,col} positions and fires one observer notification */
  clearMany(positions) {
    for (const { row, col } of positions) {
      this.clearCell(row, col);
    }
    const dirty = this.drainDirty();
    this._emit(dirty);
    return dirty;
  }

  // ─── Query Helpers ─────────────────────────────────────────────────────────

  /** Returns true if every cell in `positions` is in-bounds and empty */
  canPlace(positions) {
    return positions.every(({ row, col }) =>
      this.isInBounds(row, col) && this.cells[row][col].isEmpty
    );
  }

  /** Returns all empty cell positions */
  getEmptyCells() {
    const result = [];
    for (let r = 0; r < Grid.SIZE; r++)
      for (let c = 0; c < Grid.SIZE; c++)
        if (this.cells[r][c].isEmpty) result.push({ row: r, col: c });
    return result;
  }

  /** Returns all filled cell positions */
  getFilledCells() {
    const result = [];
    for (let r = 0; r < Grid.SIZE; r++)
      for (let c = 0; c < Grid.SIZE; c++)
        if (!this.cells[r][c].isEmpty) result.push({ row: r, col: c });
    return result;
  }

  /** Row fully filled? */
  isRowFull(row) {
    return this.cells[row].every(cell => !cell.isEmpty);
  }

  /** Column fully filled? */
  isColFull(col) {
    return this.cells.every(row => !row[col].isEmpty);
  }

  /** Returns indices of all full rows */
  getFullRows() {
    const rows = [];
    for (let r = 0; r < Grid.SIZE; r++)
      if (this.isRowFull(r)) rows.push(r);
    return rows;
  }

  /** Returns indices of all full columns */
  getFullCols() {
    const cols = [];
    for (let c = 0; c < Grid.SIZE; c++)
      if (this.isColFull(c)) cols.push(c);
    return cols;
  }

  /**
   * BFS — finds all cells connected to (startRow, startCol) that share
   * the same colorID.  Returns array of {row,col} (includes start).
   */
  getColorCluster(startRow, startCol) {
    const target = this.cells[startRow]?.[startCol];
    if (!target || target.isEmpty) return [];

    const colorID  = target.colorID;
    const visited  = new Set();
    const queue    = [{ row: startRow, col: startCol }];
    const cluster  = [];
    const key      = (r, c) => `${r},${c}`;

    visited.add(key(startRow, startCol));

    while (queue.length) {
      const { row, col } = queue.shift();
      cluster.push({ row, col });

      const neighbors = [
        { row: row - 1, col },
        { row: row + 1, col },
        { row,          col: col - 1 },
        { row,          col: col + 1 },
      ];

      for (const n of neighbors) {
        const k = key(n.row, n.col);
        if (visited.has(k)) continue;
        if (!this.isInBounds(n.row, n.col)) continue;
        const cell = this.cells[n.row][n.col];
        if (!cell.isEmpty && cell.colorID === colorID) {
          visited.add(k);
          queue.push(n);
        }
      }
    }

    return cluster;
  }

  /**
   * Scans all newly placed positions for same-color clusters ≥ minSize.
   * Returns de-duplicated array of {row,col} that should be cleared.
   */
  findClearableColorClusters(seedPositions, minSize = 6) {
    const checked  = new Set();
    const toRemove = new Set();
    const key      = (r, c) => `${r},${c}`;

    for (const { row, col } of seedPositions) {
      const k = key(row, col);
      if (checked.has(k)) continue;
      checked.add(k);

      const cluster = this.getColorCluster(row, col);
      // Mark all cells in cluster as checked so we don't BFS twice
      for (const pos of cluster) checked.add(key(pos.row, pos.col));

      if (cluster.length >= minSize) {
        for (const pos of cluster) toRemove.add(key(pos.row, pos.col));
      }
    }

    return [...toRemove].map(k => {
      const [r, c] = k.split(',').map(Number);
      return { row: r, col: c };
    });
  }

  /** Snapshot the grid as a 2-D array of colorIDs (for bitmask checks) */
  toColorMap() {
    return this.cells.map(row => row.map(cell => (cell.isEmpty ? 0 : cell.colorID)));
  }

  reset() {
    for (let r = 0; r < Grid.SIZE; r++)
      for (let c = 0; c < Grid.SIZE; c++) {
        this.cells[r][c].clear();
        this._markDirty(r, c);
      }
    const dirty = this.drainDirty();
    this._emit(dirty);
  }
}
