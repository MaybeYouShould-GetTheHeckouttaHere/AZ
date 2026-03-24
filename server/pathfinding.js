'use strict';

const state = require('./state');

// Returns true if there is a clear line of sight between two points (no walls blocking)
function hasLineOfSight(map, x1, y1, x2, y2) {
  const { rows, cols, hWalls, vWalls } = map;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return true;

  // Step along the line in small increments, checking wall crossings
  const steps = Math.ceil(dist * 20); // 20 checks per cell unit
  const sx = dx / steps;
  const sy = dy / steps;

  let px = x1;
  let py = y1;

  for (let i = 0; i < steps; i++) {
    const nx = px + sx;
    const ny = py + sy;

    // Check if we crossed a vertical wall (x crosses an integer boundary)
    const cellXBefore = Math.floor(px);
    const cellXAfter = Math.floor(nx);
    if (cellXBefore !== cellXAfter && !(nx === Math.floor(nx) && nx === px)) {
      // Crossed a vertical grid line
      const wallCol = Math.max(cellXBefore, cellXAfter);
      if (wallCol >= 0 && wallCol <= cols) {
        // Find the row at the crossing point
        const t = (wallCol - px) / (nx - px);
        const crossY = py + t * (ny - py);
        const wallRow = Math.floor(crossY);
        if (wallRow >= 0 && wallRow < rows && vWalls[wallRow][wallCol]) {
          return false;
        }
      }
    }

    // Check if we crossed a horizontal wall (y crosses an integer boundary)
    const cellYBefore = Math.floor(py);
    const cellYAfter = Math.floor(ny);
    if (cellYBefore !== cellYAfter && !(ny === Math.floor(ny) && ny === py)) {
      // Crossed a horizontal grid line
      const wallRow = Math.max(cellYBefore, cellYAfter);
      if (wallRow >= 0 && wallRow <= rows) {
        // Find the column at the crossing point
        const t = (wallRow - py) / (ny - py);
        const crossX = px + t * (nx - px);
        const wallCol = Math.floor(crossX);
        if (wallCol >= 0 && wallCol < cols && hWalls[wallRow][wallCol]) {
          return false;
        }
      }
    }

    px = nx;
    py = ny;
  }

  return true;
}

// BFS shortest path distance (in cells)
function bfsDistance(map, startCol, startRow, endCol, endRow) {
  const { rows, cols, hWalls, vWalls } = map;
  const sr = Math.max(0, Math.min(rows - 1, Math.floor(startRow)));
  const sc = Math.max(0, Math.min(cols - 1, Math.floor(startCol)));
  const er = Math.max(0, Math.min(rows - 1, Math.floor(endRow)));
  const ec = Math.max(0, Math.min(cols - 1, Math.floor(endCol)));

  if (sr === er && sc === ec) return 0;

  const visited = [];
  for (let r = 0; r < rows; r++) {
    visited[r] = [];
    for (let c = 0; c < cols; c++) {
      visited[r][c] = false;
    }
  }

  const queue = [[sr, sc, 0]];
  visited[sr][sc] = true;

  while (queue.length > 0) {
    const [cr, cc, dist] = queue.shift();

    // Check 4 neighbors
    // Up: check hWalls[cr][cc] (top wall of current cell)
    if (cr > 0 && !visited[cr - 1][cc] && !hWalls[cr][cc]) {
      if (cr - 1 === er && cc === ec) return dist + 1;
      visited[cr - 1][cc] = true;
      queue.push([cr - 1, cc, dist + 1]);
    }
    // Down: check hWalls[cr+1][cc] (bottom wall of current cell)
    if (cr < rows - 1 && !visited[cr + 1][cc] && !hWalls[cr + 1][cc]) {
      if (cr + 1 === er && cc === ec) return dist + 1;
      visited[cr + 1][cc] = true;
      queue.push([cr + 1, cc, dist + 1]);
    }
    // Left: check vWalls[cr][cc] (left wall of current cell)
    if (cc > 0 && !visited[cr][cc - 1] && !vWalls[cr][cc]) {
      if (cr === er && cc - 1 === ec) return dist + 1;
      visited[cr][cc - 1] = true;
      queue.push([cr, cc - 1, dist + 1]);
    }
    // Right: check vWalls[cr][cc+1] (right wall of current cell)
    if (cc < cols - 1 && !visited[cr][cc + 1] && !vWalls[cr][cc + 1]) {
      if (cr === er && cc + 1 === ec) return dist + 1;
      visited[cr][cc + 1] = true;
      queue.push([cr, cc + 1, dist + 1]);
    }
  }

  return Infinity; // unreachable (shouldn't happen in a connected maze)
}

// BFS next waypoint (for missile pathfinding)
function bfsNextWaypoint(map, fromX, fromY, toX, toY) {
  const { rows, cols, hWalls, vWalls } = map;
  const sr = Math.max(0, Math.min(rows - 1, Math.floor(fromY)));
  const sc = Math.max(0, Math.min(cols - 1, Math.floor(fromX)));
  const er = Math.max(0, Math.min(rows - 1, Math.floor(toY)));
  const ec = Math.max(0, Math.min(cols - 1, Math.floor(toX)));

  if (sr === er && sc === ec) {
    return { x: toX, y: toY };
  }

  const visited = [];
  const parent = [];
  for (let r = 0; r < rows; r++) {
    visited[r] = new Array(cols).fill(false);
    parent[r] = new Array(cols).fill(null);
  }

  const queue = [[sr, sc]];
  visited[sr][sc] = true;
  let found = false;

  while (queue.length > 0) {
    const [cr, cc] = queue.shift();
    if (cr === er && cc === ec) { found = true; break; }

    if (cr > 0 && !visited[cr - 1][cc] && !hWalls[cr][cc]) {
      visited[cr - 1][cc] = true;
      parent[cr - 1][cc] = [cr, cc];
      queue.push([cr - 1, cc]);
    }
    if (cr < rows - 1 && !visited[cr + 1][cc] && !hWalls[cr + 1][cc]) {
      visited[cr + 1][cc] = true;
      parent[cr + 1][cc] = [cr, cc];
      queue.push([cr + 1, cc]);
    }
    if (cc > 0 && !visited[cr][cc - 1] && !vWalls[cr][cc]) {
      visited[cr][cc - 1] = true;
      parent[cr][cc - 1] = [cr, cc];
      queue.push([cr, cc - 1]);
    }
    if (cc < cols - 1 && !visited[cr][cc + 1] && !vWalls[cr][cc + 1]) {
      visited[cr][cc + 1] = true;
      parent[cr][cc + 1] = [cr, cc];
      queue.push([cr, cc + 1]);
    }
  }

  if (!found) return { x: toX, y: toY };

  let cur = [er, ec];
  while (parent[cur[0]][cur[1]]) {
    const p = parent[cur[0]][cur[1]];
    if (p[0] === sr && p[1] === sc) break;
    cur = p;
  }

  return { x: cur[1] + 0.5, y: cur[0] + 0.5 };
}

// Dijkstra path from world position to world position, penalising 180° turns.
// State: (row, col, direction). 90° turns cost 1 (same as straight). 180° turns
// cost 1 + U_TURN_PENALTY, so the algorithm only reverses when the detour saves
// significantly more cells than the penalty.
// Returns array of [col, row] cell indices (start→end), or null if unreachable.
function bfsFullPath(map, fromX, fromY, fromAngle, toX, toY) {
  const { rows, cols, hWalls, vWalls } = map;
  const sr = Math.max(0, Math.min(rows - 1, Math.floor(fromY)));
  const sc = Math.max(0, Math.min(cols - 1, Math.floor(fromX)));
  const er = Math.max(0, Math.min(rows - 1, Math.floor(toY)));
  const ec = Math.max(0, Math.min(cols - 1, Math.floor(toX)));

  if (sr === er && sc === ec) return [[sc, sr]];

  const U_TURN_PENALTY = 15;

  // Directions: 0=right(+col), 1=down(+row), 2=left(-col), 3=up(-row)
  const DR = [0, 1, 0, -1];
  const DC = [1, 0, -1, 0];

  // Quantize missile angle to nearest grid direction
  const adx = Math.cos(fromAngle);
  const ady = Math.sin(fromAngle);
  const startDir = Math.abs(adx) >= Math.abs(ady)
    ? (adx >= 0 ? 0 : 2)
    : (ady >= 0 ? 1 : 3);

  // dist[r][c][d] = min cost to reach (r,c) arriving via direction d
  const dist = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => [Infinity, Infinity, Infinity, Infinity])
  );
  const par = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => [null, null, null, null])
  );

  dist[sr][sc][startDir] = 0;
  // [cost, row, col, dir]
  const pq = [[0, sr, sc, startDir]];

  while (pq.length > 0) {
    // Extract minimum-cost entry
    let mi = 0;
    for (let i = 1; i < pq.length; i++) { if (pq[i][0] < pq[mi][0]) mi = i; }
    const [cost, cr, cc, cd] = pq[mi];
    pq.splice(mi, 1);

    if (cost > dist[cr][cc][cd]) continue; // stale entry

    if (cr === er && cc === ec) {
      // Reconstruct [col, row] path
      const path = [];
      let cur = [cr, cc, cd];
      while (cur !== null) {
        path.push([cur[1], cur[0]]);
        cur = par[cur[0]][cur[1]][cur[2]];
      }
      path.reverse();
      return path;
    }

    for (let nd = 0; nd < 4; nd++) {
      const nr = cr + DR[nd];
      const nc = cc + DC[nd];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

      // Wall check (same convention as bfsDistance)
      if (nd === 3 && hWalls[cr][cc]) continue;      // up
      if (nd === 1 && hWalls[cr + 1][cc]) continue;  // down
      if (nd === 2 && vWalls[cr][cc]) continue;       // left
      if (nd === 0 && vWalls[cr][cc + 1]) continue;  // right

      const turnDiff = (nd - cd + 4) % 4;
      const newCost = cost + 1 + (turnDiff === 2 ? U_TURN_PENALTY : 0);

      if (newCost < dist[nr][nc][nd]) {
        dist[nr][nc][nd] = newCost;
        par[nr][nc][nd] = [cr, cc, cd];
        pq.push([newCost, nr, nc, nd]);
      }
    }
  }

  return null;
}

// Missile target selection
function selectMissileTarget(missile, map) {
  const { players } = state;
  let bestTarget = null;
  let bestScore = Infinity;

  for (const [id, player] of players) {
    if (!player.alive) continue;
    const bfsDist = bfsDistance(map, missile.x, missile.y, player.x, player.y);
    const eucDist = Math.hypot(missile.x - player.x, missile.y - player.y);
    const score = bfsDist * 10 + eucDist;
    if (score < bestScore) {
      bestScore = score;
      bestTarget = id;
    }
  }
  return bestTarget;
}

module.exports = { hasLineOfSight, bfsDistance, bfsNextWaypoint, selectMissileTarget, bfsFullPath };
