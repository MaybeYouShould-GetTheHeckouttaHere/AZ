'use strict';

// Check if circle (cx, cy, r) collides with line segment (x1,y1)-(x2,y2)
function circleCollidesSegment(cx, cy, r, x1, y1, x2, y2) {
  const abx = x2 - x1;
  const aby = y2 - y1;
  const acx = cx - x1;
  const acy = cy - y1;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return Math.hypot(acx, acy) < r;
  const t = Math.max(0, Math.min(1, (acx * abx + acy * aby) / ab2));
  const closestX = x1 + t * abx;
  const closestY = y1 + t * aby;
  const dist = Math.hypot(cx - closestX, cy - closestY);
  return dist < r;
}

// Return closest point on segment (x1,y1)-(x2,y2) to point (px,py)
function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const abx = x2 - x1;
  const aby = y2 - y1;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return { x: x1, y: y1 };
  const t = Math.max(0, Math.min(1, ((px - x1) * abx + (py - y1) * aby) / ab2));
  return { x: x1 + t * abx, y: y1 + t * aby };
}

// Resolve tank position against all nearby walls (full 2D resolution)
function resolveTankCollision(x, y, r, map) {
  const { rows, cols, hWalls, vWalls } = map;

  // Clamp to boundary
  x = Math.max(r, Math.min(cols - r, x));
  y = Math.max(r, Math.min(rows - r, y));

  // Collect all nearby wall segments
  const minRow = Math.max(0, Math.floor(y - r - 1));
  const maxRow = Math.min(rows, Math.floor(y + r + 1) + 1);
  const minCol = Math.max(0, Math.floor(x - r - 1));
  const maxCol = Math.min(cols, Math.floor(x + r + 1) + 1);

  // Multiple passes to resolve overlaps (handles corners)
  for (let pass = 0; pass < 3; pass++) {
    let pushed = false;

    // Check vertical walls
    for (let c = minCol; c <= Math.min(cols, maxCol); c++) {
      for (let row = minRow; row <= Math.min(rows - 1, maxRow); row++) {
        if (!vWalls[row] || !vWalls[row][c]) continue;
        // Wall segment at x=c, from y=row to y=row+1
        const closest = closestPointOnSegment(x, y, c, row, c, row + 1);
        const dist = Math.hypot(x - closest.x, y - closest.y);
        if (dist < r) {
          const penetration = r - dist;
          if (dist > 0.0001) {
            x += (x - closest.x) / dist * penetration;
            y += (y - closest.y) / dist * penetration;
          } else {
            x += (x < c) ? -penetration : penetration;
          }
          pushed = true;
        }
      }
    }

    // Check horizontal walls
    for (let row = minRow; row <= Math.min(rows, maxRow); row++) {
      for (let c = minCol; c <= Math.min(cols - 1, maxCol); c++) {
        if (!hWalls[row] || !hWalls[row][c]) continue;
        // Wall segment at y=row, from x=c to x=c+1
        const closest = closestPointOnSegment(x, y, c, row, c + 1, row);
        const dist = Math.hypot(x - closest.x, y - closest.y);
        if (dist < r) {
          const penetration = r - dist;
          if (dist > 0.0001) {
            x += (x - closest.x) / dist * penetration;
            y += (y - closest.y) / dist * penetration;
          } else {
            y += (y < row) ? -penetration : penetration;
          }
          pushed = true;
        }
      }
    }

    if (!pushed) break;
  }

  // Final boundary clamp
  x = Math.max(r, Math.min(cols - r, x));
  y = Math.max(r, Math.min(rows - r, y));
  return { x, y };
}

// Find the first wall a bullet circle collides with near a point.
// Returns { type: 'h'|'v', wx1, wy1, wx2, wy2 } or null.
function findFirstWallCollision(px, py, radius, map) {
  const { rows, cols, hWalls, vWalls } = map;
  const minRow = Math.max(0, Math.floor(py - radius - 1));
  const maxRow = Math.min(rows, Math.ceil(py + radius + 1));
  const minCol = Math.max(0, Math.floor(px - radius - 1));
  const maxCol = Math.min(cols, Math.ceil(px + radius + 1));

  let bestDist = Infinity;
  let bestWall = null;

  for (let row = minRow; row <= maxRow; row++) {
    for (let c = minCol; c <= maxCol; c++) {
      // Check horizontal walls
      if (row <= rows && c < cols && hWalls[row] && hWalls[row][c]) {
        if (circleCollidesSegment(px, py, radius, c, row, c + 1, row)) {
          const d = Math.abs(py - row);
          if (d < bestDist) { bestDist = d; bestWall = { type: 'h' }; }
        }
      }
      // Check vertical walls
      if (row < rows && c <= cols && vWalls[row] && vWalls[row][c]) {
        if (circleCollidesSegment(px, py, radius, c, row, c, row + 1)) {
          const d = Math.abs(px - c);
          if (d < bestDist) { bestDist = d; bestWall = { type: 'v' }; }
        }
      }
    }
  }
  return bestWall;
}

// Step along the ray from tank center to barrel tip, checking bullet circle
// collision at each step. Returns { x, y, type } if a wall blocks the path.
function raycastBulletSpawn(x1, y1, x2, y2, bulletRadius, map) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return null;

  const STEP = 0.02; // step size in cells (< 1/3 wall width)
  const numSteps = Math.ceil(dist / STEP);

  for (let i = 1; i <= numSteps; i++) {
    const t = Math.min(i / numSteps, 1.0);
    const px = x1 + dx * t;
    const py = y1 + dy * t;

    const wallHit = findFirstWallCollision(px, py, bulletRadius, map);
    if (wallHit) {
      // Step back to the previous position (safe side of wall)
      const prevT = Math.max((i - 1) / numSteps, 0.0);
      let spawnX = x1 + dx * prevT;
      let spawnY = y1 + dy * prevT;

      // If prevT is 0 (first step hit wall), use tank center offset slightly
      if (prevT < 0.001) {
        spawnX = x1;
        spawnY = y1;
      }

      return { x: spawnX, y: spawnY, type: wallHit.type };
    }
  }

  return null; // clear path to barrel tip
}

module.exports = {
  circleCollidesSegment,
  resolveTankCollision,
  closestPointOnSegment,
  findFirstWallCollision,
  raycastBulletSpawn,
};
