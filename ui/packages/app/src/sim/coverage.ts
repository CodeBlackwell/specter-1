import type { AOBounds } from "./world";

export type CoverageGrid = {
  cellSize: number;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  firstSeen: Int32Array;
};

export function newCoverageGrid(bounds: AOBounds, cellSize: number): CoverageGrid {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cellSize);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / cellSize);
  const firstSeen = new Int32Array(cols * rows);
  firstSeen.fill(-1);
  return { cellSize, cols, rows, originX: bounds.minX, originY: bounds.minY, firstSeen };
}

export function cellIndex(grid: CoverageGrid, col: number, row: number): number {
  return row * grid.cols + col;
}

export function cellCenter(grid: CoverageGrid, col: number, row: number): { x: number; y: number } {
  return {
    x: grid.originX + (col + 0.5) * grid.cellSize,
    y: grid.originY + (row + 0.5) * grid.cellSize,
  };
}

export function worldToCell(grid: CoverageGrid, x: number, y: number): { col: number; row: number } {
  return {
    col: Math.floor((x - grid.originX) / grid.cellSize),
    row: Math.floor((y - grid.originY) / grid.cellSize),
  };
}

export function markCovered(
  grid: CoverageGrid,
  x: number,
  y: number,
  radius: number,
  tick: number,
): void {
  const r2 = radius * radius;
  const minCol = Math.max(0, Math.floor((x - radius - grid.originX) / grid.cellSize));
  const maxCol = Math.min(grid.cols - 1, Math.floor((x + radius - grid.originX) / grid.cellSize));
  const minRow = Math.max(0, Math.floor((y - radius - grid.originY) / grid.cellSize));
  const maxRow = Math.min(grid.rows - 1, Math.floor((y + radius - grid.originY) / grid.cellSize));
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const c = cellCenter(grid, col, row);
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy > r2) continue;
      const i = cellIndex(grid, col, row);
      if (grid.firstSeen[i] === -1) grid.firstSeen[i] = tick;
    }
  }
}

export function isCovered(grid: CoverageGrid, col: number, row: number, currentTick: number): boolean {
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return false;
  const f = grid.firstSeen[cellIndex(grid, col, row)] ?? -1;
  return f !== -1 && f <= currentTick;
}

export function findFrontiers(grid: CoverageGrid, currentTick: number): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (isCovered(grid, col, row, currentTick)) continue;
      const adjacent =
        isCovered(grid, col - 1, row, currentTick) ||
        isCovered(grid, col + 1, row, currentTick) ||
        isCovered(grid, col, row - 1, currentTick) ||
        isCovered(grid, col, row + 1, currentTick);
      if (adjacent) out.push({ col, row });
    }
  }
  return out;
}

export function findAnyUnseen(grid: CoverageGrid, currentTick: number): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!isCovered(grid, col, row, currentTick)) out.push({ col, row });
    }
  }
  return out;
}
