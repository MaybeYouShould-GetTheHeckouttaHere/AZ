const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');

// --- Constants ---
const PORT = 55928;
const TICK_RATE = 60;
const MSG_RATE_LIMIT = 120; // max messages per second per player

const PRESET_COLORS = [
  { name: 'Red',    hex: '#E74C3C', hue: 6   },
  { name: 'Blue',   hex: '#3498DB', hue: 204 },
  { name: 'Green',  hex: '#2ECC71', hue: 145 },
  { name: 'Orange', hex: '#E67E22', hue: 28  },
  { name: 'Purple', hex: '#9B59B6', hue: 283 },
  { name: 'Teal',   hex: '#1ABC9C', hue: 168 },
  { name: 'Yellow', hex: '#F1C40F', hue: 48  },
  { name: 'Pink',   hex: '#E91E63', hue: 340 },
];

// --- Physics Constants ---
const TANK_RADIUS = 0.25;
const BULLET_RADIUS = 0.075;
const TANK_SPEED = 3;           // cells per second
const ROTATION_SPEED = Math.PI; // radians per second (180 deg/s)
const BULLET_SPEED = 6;         // cells per second
const MAX_BOUNCES = 6;
const TANK_HP = 3;
const DT = 1 / TICK_RATE;

// --- Game State ---
let gameState = 'lobby'; // lobby | playing | roundEnd
let players = new Map();  // id -> { ws, color, input, alive, msgTimestamps, x, y, angle, hp, spacePrev }
let nextPlayerId = 1;
let tickInterval = null;
let bullets = [];          // { ownerId, x, y, dx, dy, bouncesLeft }
let currentMap = null;
let scores = {};           // playerId -> number of wins
let rematchVotes = new Set();
let roundEndTimer = null;  // 5-second auto-restart timer

// --- Color Assignment ---
function assignColor(playerIndex) {
  if (playerIndex < PRESET_COLORS.length) {
    return PRESET_COLORS[playerIndex].hex;
  }
  // Generate via HSL wheel, skipping within 30 degrees of preset hues
  const presetHues = PRESET_COLORS.map(c => c.hue);
  const totalSlots = playerIndex - PRESET_COLORS.length + 1;
  let candidateHue = 0;
  let found = 0;
  for (let h = 0; h < 360; h += Math.floor(360 / (PRESET_COLORS.length + totalSlots + 8))) {
    const tooClose = presetHues.some(ph => {
      const diff = Math.abs(h - ph);
      return Math.min(diff, 360 - diff) < 30;
    });
    if (!tooClose) {
      if (found === totalSlots - 1) {
        candidateHue = h;
        break;
      }
      found++;
    }
  }
  // Fallback: evenly space extra players
  if (found < totalSlots - 1) {
    candidateHue = (playerIndex * 137) % 360; // golden angle spread
  }
  return hslToHex(candidateHue, 70, 50);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// --- Map Generation ---
function generateMap(playerCount) {
  const size = 6 + 3 * playerCount;
  const rows = size;
  const cols = size;

  // Initialize all walls to true
  // hWalls[r][c]: horizontal wall on top edge of row r, column c
  // hWalls has (rows+1) rows and cols columns
  const hWalls = [];
  for (let r = 0; r <= rows; r++) {
    hWalls[r] = [];
    for (let c = 0; c < cols; c++) {
      hWalls[r][c] = true;
    }
  }

  // vWalls[r][c]: vertical wall on left edge of row r, column c
  // vWalls has rows rows and (cols+1) columns
  const vWalls = [];
  for (let r = 0; r < rows; r++) {
    vWalls[r] = [];
    for (let c = 0; c <= cols; c++) {
      vWalls[r][c] = true;
    }
  }

  // Recursive backtracker (iterative stack-based) starting from (0,0)
  const visited = [];
  for (let r = 0; r < rows; r++) {
    visited[r] = [];
    for (let c = 0; c < cols; c++) {
      visited[r][c] = false;
    }
  }

  const stack = [];
  visited[0][0] = true;
  stack.push([0, 0]);

  while (stack.length > 0) {
    const [cr, cc] = stack[stack.length - 1];
    // Get unvisited neighbors
    const neighbors = [];
    if (cr > 0 && !visited[cr - 1][cc]) neighbors.push([cr - 1, cc, 'up']);
    if (cr < rows - 1 && !visited[cr + 1][cc]) neighbors.push([cr + 1, cc, 'down']);
    if (cc > 0 && !visited[cr][cc - 1]) neighbors.push([cr, cc - 1, 'left']);
    if (cc < cols - 1 && !visited[cr][cc + 1]) neighbors.push([cr, cc + 1, 'right']);

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    // Shuffle neighbors randomly
    for (let i = neighbors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
    }

    const [nr, nc, dir] = neighbors[0];
    // Remove wall between current and neighbor
    if (dir === 'up') {
      hWalls[cr][cc] = false; // wall on top of current cell
    } else if (dir === 'down') {
      hWalls[cr + 1][cc] = false; // wall on bottom of current = top of next
    } else if (dir === 'left') {
      vWalls[cr][cc] = false; // wall on left of current cell
    } else if (dir === 'right') {
      vWalls[cr][cc + 1] = false; // wall on right of current = left of next
    }

    visited[nr][nc] = true;
    stack.push([nr, nc]);
  }

  // Count interior walls and remove ~30-35% to open up the maze
  const interiorWalls = [];
  // Interior horizontal walls: rows 1..rows-1 (not 0 or rows, those are boundary)
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (hWalls[r][c]) {
        interiorWalls.push({ type: 'h', r, c });
      }
    }
  }
  // Interior vertical walls: cols 1..cols-1 (not 0 or cols, those are boundary)
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      if (vWalls[r][c]) {
        interiorWalls.push({ type: 'v', r, c });
      }
    }
  }

  // Shuffle and remove ~32% of remaining interior walls
  for (let i = interiorWalls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [interiorWalls[i], interiorWalls[j]] = [interiorWalls[j], interiorWalls[i]];
  }
  const removeCount = Math.floor(interiorWalls.length * 0.32);
  for (let i = 0; i < removeCount; i++) {
    const w = interiorWalls[i];
    if (w.type === 'h') {
      hWalls[w.r][w.c] = false;
    } else {
      vWalls[w.r][w.c] = false;
    }
  }

  return { rows, cols, hWalls, vWalls };
}

// --- Line of Sight Check ---
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

// --- BFS shortest path distance (in cells) ---
function bfsDistance(map, startCol, startRow, endCol, endRow) {
  const { rows, cols, hWalls, vWalls } = map;
  const sr = Math.floor(startRow);
  const sc = Math.floor(startCol);
  const er = Math.floor(endRow);
  const ec = Math.floor(endCol);

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

// --- Spawn Players ---
function spawnPlayers(map, players) {
  const spawns = []; // array of {x, y} for placed players

  for (const [id, player] of players) {
    let bestPos = null;

    if (spawns.length === 0) {
      // First player: random cell
      const c = Math.floor(Math.random() * map.cols);
      const r = Math.floor(Math.random() * map.rows);
      bestPos = { x: c + 0.5, y: r + 0.5 };
    } else {
      // Try up to 20 random positions
      const candidates = [];
      let foundNoLOS = false;

      for (let attempt = 0; attempt < 20; attempt++) {
        const c = Math.floor(Math.random() * map.cols);
        const r = Math.floor(Math.random() * map.rows);
        const cx = c + 0.5;
        const cy = r + 0.5;

        candidates.push({ x: cx, y: cy });

        // Check LOS to all placed players
        let anyLOS = false;
        for (const sp of spawns) {
          if (hasLineOfSight(map, cx, cy, sp.x, sp.y)) {
            anyLOS = true;
            break;
          }
        }

        if (!anyLOS) {
          // No line of sight to any placed player - accept
          bestPos = { x: cx, y: cy };
          foundNoLOS = true;
          break;
        }
      }

      if (!foundNoLOS) {
        // All 20 candidates had LOS to some player
        // Pick the one with greatest shortest-path to nearest placed player
        let bestDist = -1;
        for (const cand of candidates) {
          let minDist = Infinity;
          for (const sp of spawns) {
            const d = bfsDistance(map, cand.x, cand.y, sp.x, sp.y);
            if (d < minDist) minDist = d;
          }
          if (minDist > bestDist) {
            bestDist = minDist;
            bestPos = cand;
          }
        }
      }
    }

    player.x = bestPos.x;
    player.y = bestPos.y;
    player.angle = Math.random() * 2 * Math.PI;
    spawns.push(bestPos);
  }

  return spawns;
}

// --- Debug Map Printer ---
function debugPrintMap(map, spawns) {
  const { rows, cols, hWalls, vWalls } = map;

  // Build spawn lookup: cell (r,c) -> player number
  const spawnCells = {};
  if (spawns) {
    spawns.forEach((sp, i) => {
      const r = Math.floor(sp.y);
      const c = Math.floor(sp.x);
      spawnCells[`${r},${c}`] = i + 1;
    });
  }

  const lines = [];
  for (let r = 0; r <= rows; r++) {
    // Horizontal wall line
    let hLine = '+';
    for (let c = 0; c < cols; c++) {
      hLine += hWalls[r][c] ? '---+' : '   +';
    }
    lines.push(hLine);

    // Cell content + vertical walls line
    if (r < rows) {
      let vLine = vWalls[r][0] ? '|' : ' ';
      for (let c = 0; c < cols; c++) {
        const key = `${r},${c}`;
        const content = spawnCells[key] ? ` ${spawnCells[key]} ` : '   ';
        vLine += content;
        vLine += vWalls[r][c + 1] ? '|' : ' ';
      }
      lines.push(vLine);
    }
  }

  console.log('\n=== MAP ===');
  lines.forEach(l => console.log(l));
  console.log('===========\n');
}

// --- Collision Helpers ---

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

// Return closest point on segment (x1,y1)-(x2,y2) to point (px,py)
function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const abx = x2 - x1;
  const aby = y2 - y1;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return { x: x1, y: y1 };
  const t = Math.max(0, Math.min(1, ((px - x1) * abx + (py - y1) * aby) / ab2));
  return { x: x1 + t * abx, y: y1 + t * aby };
}

// Raycast a thin ray from tank center to bullet spawn point.
// Step size < 1/3 wall thickness to never skip over a wall.
// Returns {x, y, type: 'h'|'v'} — the last clear position before the wall,
// plus which wall type was hit. Returns null if path is clear.
function raycastBulletSpawn(x1, y1, x2, y2, bulletRadius, map) {
  const { rows, cols, hWalls, vWalls } = map;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return null;

  // Step size: less than 1/3 of the wall visual thickness in cell units.
  // Walls are on grid lines, effectively zero-width in physics, but we use
  // a small step to ensure we detect crossing any grid-aligned wall edge.
  const stepSize = 0.02; // ~1/50th of a cell, well under 1/3 wall width
  const steps = Math.ceil(dist / stepSize);
  const sx = dx / steps;
  const sy = dy / steps;

  let px = x1;
  let py = y1;
  let lastClearX = x1;
  let lastClearY = y1;

  for (let i = 1; i <= steps; i++) {
    const nx = x1 + sx * i;
    const ny = y1 + sy * i;

    // Check if we crossed a vertical wall (x crosses an integer boundary)
    const cellXBefore = Math.floor(px + 0.0001);
    const cellXAfter = Math.floor(nx + 0.0001);
    if (Math.floor(px) !== Math.floor(nx) || (Number.isInteger(Math.round(nx * 1000) / 1000) && !Number.isInteger(Math.round(px * 1000) / 1000))) {
      // Determine which vertical grid line we crossed
      const wallCol = (nx > px) ? Math.ceil(px) : Math.floor(px);
      if (wallCol >= 0 && wallCol <= cols) {
        // Find the row at the crossing point
        const t = (Math.abs(nx - px) > 0.0001) ? (wallCol - px) / (nx - px) : 0;
        const crossY = py + t * (ny - py);
        const wallRow = Math.floor(crossY);
        if (wallRow >= 0 && wallRow < rows && vWalls[wallRow] && vWalls[wallRow][wallCol]) {
          // Hit a vertical wall — return last clear position, pushed back by bullet radius
          const backX = wallCol + ((px < wallCol) ? -bulletRadius : bulletRadius);
          return { x: backX, y: crossY, type: 'v' };
        }
      }
    }

    // Check if we crossed a horizontal wall (y crosses an integer boundary)
    if (Math.floor(py) !== Math.floor(ny) || (Number.isInteger(Math.round(ny * 1000) / 1000) && !Number.isInteger(Math.round(py * 1000) / 1000))) {
      const wallRow = (ny > py) ? Math.ceil(py) : Math.floor(py);
      if (wallRow >= 0 && wallRow <= rows) {
        const t = (Math.abs(ny - py) > 0.0001) ? (wallRow - py) / (ny - py) : 0;
        const crossX = px + t * (nx - px);
        const wallCol = Math.floor(crossX);
        if (wallCol >= 0 && wallCol < cols && hWalls[wallRow] && hWalls[wallRow][wallCol]) {
          // Hit a horizontal wall — return last clear position, pushed back by bullet radius
          const backY = wallRow + ((py < wallRow) ? -bulletRadius : bulletRadius);
          return { x: crossX, y: backY, type: 'h' };
        }
      }
    }

    lastClearX = nx;
    lastClearY = ny;
    px = nx;
    py = ny;
  }

  return null; // path is clear
}

// Check if position is inside a wall (for bullet spawn check)
function isInsideWall(px, py, radius, map) {
  const { rows, cols, hWalls, vWalls } = map;
  const minRow = Math.max(0, Math.floor(py - 1));
  const maxRow = Math.min(rows, Math.floor(py + 1) + 1);
  const minCol = Math.max(0, Math.floor(px - 1));
  const maxCol = Math.min(cols, Math.floor(px + 1) + 1);

  for (let row = minRow; row <= maxRow; row++) {
    for (let c = minCol; c <= maxCol; c++) {
      // Check horizontal walls
      if (row <= rows && c < cols && hWalls[row] && hWalls[row][c]) {
        if (circleCollidesSegment(px, py, radius, c, row, c + 1, row)) return true;
      }
      // Check vertical walls
      if (row < rows && c <= cols && vWalls[row] && vWalls[row][c] !== undefined) {
        if (vWalls[row][c] && circleCollidesSegment(px, py, radius, c, row, c, row + 1)) return true;
      }
    }
  }
  return false;
}

let frameHits = []; // [{x, y}] - bullet impact positions this tick

function tick() {
  if (!currentMap) return;
  const map = currentMap;
  frameHits = [];

  // --- Tank Movement ---
  for (const [id, player] of players) {
    if (!player.alive) continue;
    const keys = player.input;

    // Rotation
    if (keys.a) player.angle -= ROTATION_SPEED * DT;
    if (keys.d) player.angle += ROTATION_SPEED * DT;

    // Movement
    let dx = 0;
    let dy = 0;
    if (keys.w) {
      dx = Math.cos(player.angle) * TANK_SPEED * DT;
      dy = Math.sin(player.angle) * TANK_SPEED * DT;
    } else if (keys.s) {
      dx = -Math.cos(player.angle) * TANK_SPEED * DT;
      dy = -Math.sin(player.angle) * TANK_SPEED * DT;
    }

    if (dx !== 0 || dy !== 0) {
      const resolved = resolveTankCollision(player.x + dx, player.y + dy, TANK_RADIUS, map);
      player.x = resolved.x;
      player.y = resolved.y;
    }

    // --- Bullet Firing (edge trigger) ---
    if (keys.space && !player.spacePrev) {
      // Check if player has no active bullet
      const hasActiveBullet = bullets.some(b => b.ownerId === id);
      if (!hasActiveBullet) {
        const cosA = Math.cos(player.angle);
        const sinA = Math.sin(player.angle);
        let bdx = cosA * BULLET_SPEED;
        let bdy = sinA * BULLET_SPEED;

        // Raycast from tank center toward barrel tip to find first wall hit
        const spawnDist = 0.35;
        const tipX = player.x + cosA * spawnDist;
        const tipY = player.y + sinA * spawnDist;
        const hit = raycastBulletSpawn(player.x, player.y, tipX, tipY, BULLET_RADIUS, map);

        let bx, by;
        if (hit) {
          // Wall is in the way — spawn at hit point and bounce off it
          bx = hit.x;
          by = hit.y;
          if (hit.type === 'h') {
            bdy = -bdy; // reflect off horizontal wall
          } else {
            bdx = -bdx; // reflect off vertical wall
          }
        } else {
          // Clear path — spawn at barrel tip
          bx = tipX;
          by = tipY;
        }

        bullets.push({
          ownerId: id,
          x: bx,
          y: by,
          dx: bdx,
          dy: bdy,
          bouncesLeft: hit ? MAX_BOUNCES - 1 : MAX_BOUNCES,
        });

        if (hit) {
          frameHits.push({ x: bx, y: by });
        }
      }
    }
    player.spacePrev = keys.space;
  }

  // --- Bullet Movement & Wall Bouncing ---
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.dx * DT;
    b.y += b.dy * DT;

    const { rows, cols, hWalls, vWalls } = map;

    // Check wall collisions
    let hitH = false;
    let hitV = false;
    let pushRow = 0;
    let pushCol = 0;

    const minRow = Math.max(0, Math.floor(b.y - 1));
    const maxRow = Math.min(rows, Math.floor(b.y + 1) + 1);
    const minCol = Math.max(0, Math.floor(b.x - 1));
    const maxCol = Math.min(cols, Math.floor(b.x + 1) + 1);

    // Check horizontal walls
    for (let row = minRow; row <= maxRow && !hitH; row++) {
      for (let c = minCol; c <= Math.min(cols - 1, maxCol); c++) {
        if (row > rows || c >= cols) continue;
        if (!hWalls[row] || !hWalls[row][c]) continue;
        if (circleCollidesSegment(b.x, b.y, BULLET_RADIUS, c, row, c + 1, row)) {
          hitH = true;
          pushRow = row;
          break;
        }
      }
    }

    // Check vertical walls
    for (let c = minCol; c <= maxCol && !hitV; c++) {
      for (let row = minRow; row <= Math.min(rows - 1, maxRow); row++) {
        if (c > cols || row >= rows) continue;
        if (!vWalls[row] || vWalls[row][c] === undefined || !vWalls[row][c]) continue;
        if (circleCollidesSegment(b.x, b.y, BULLET_RADIUS, c, row, c, row + 1)) {
          hitV = true;
          pushCol = c;
          break;
        }
      }
    }

    if (hitH || hitV) {
      frameHits.push({ x: b.x, y: b.y });
      b.bouncesLeft--;
      if (b.bouncesLeft < 0) {
        // Destroy bullet
        bullets.splice(i, 1);
        continue;
      }

      if (hitH) {
        b.dy = -b.dy;
        // Push out of horizontal wall
        if (b.y < pushRow) {
          b.y = pushRow - BULLET_RADIUS;
        } else {
          b.y = pushRow + BULLET_RADIUS;
        }
      }
      if (hitV) {
        b.dx = -b.dx;
        // Push out of vertical wall
        if (b.x < pushCol) {
          b.x = pushCol - BULLET_RADIUS;
        } else {
          b.x = pushCol + BULLET_RADIUS;
        }
      }
    }

    // Safety clamp (outer walls already handled above, but prevent escape)
    b.x = Math.max(BULLET_RADIUS, Math.min(cols - BULLET_RADIUS, b.x));
    b.y = Math.max(BULLET_RADIUS, Math.min(rows - BULLET_RADIUS, b.y));
  }

  // --- Bullet-Tank Collision ---
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    for (const [id, player] of players) {
      if (!player.alive) continue;
      const dist = Math.hypot(b.x - player.x, b.y - player.y);
      if (dist < BULLET_RADIUS + TANK_RADIUS) {
        // Hit!
        frameHits.push({ x: b.x, y: b.y });
        player.hp--;
        if (player.hp <= 0) {
          player.alive = false;
        }
        bullets.splice(i, 1);
        break; // bullet is gone, move to next
      }
    }
  }

  // --- Round End Check ---
  let aliveCount = 0;
  let lastAliveId = null;
  for (const [id, player] of players) {
    if (player.alive) {
      aliveCount++;
      lastAliveId = id;
    }
  }

  if (aliveCount <= 1) {
    const winnerId = aliveCount === 1 ? lastAliveId : null;
    broadcastState(); // send final state showing the killing blow
    endRound(winnerId);
    return;
  }

  broadcastState();
}

function endRound(winnerId) {
  // Stop the tick loop
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }

  gameState = 'roundEnd';

  // Increment winner's score
  if (winnerId !== null) {
    if (scores[winnerId] === undefined) scores[winnerId] = 0;
    scores[winnerId]++;
    console.log(`Round ended - Player ${winnerId} wins!`);
  } else {
    console.log('Round ended - Tie!');
  }

  // Reset rematch votes
  rematchVotes = new Set();

  // Broadcast roundEnd
  const msg = JSON.stringify({
    type: 'roundEnd',
    winnerId,
    scores,
  });
  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }

  // Set 5-second auto-restart timer
  console.log('Waiting for new round...');
  roundEndTimer = setTimeout(() => {
    roundEndTimer = null;
    if (players.size >= 2) {
      startNewRound();
    } else {
      gameState = 'lobby';
      console.log('Not enough players for new round. Returning to lobby.');
    }
  }, 5000);
}

function startNewRound() {
  gameState = 'playing';
  bullets = [];
  currentMap = generateMap(players.size);
  const spawns = spawnPlayers(currentMap, players);
  debugPrintMap(currentMap, spawns);

  // Initialize player game state
  for (const [id, player] of players) {
    player.hp = TANK_HP;
    player.alive = true;
    player.spacePrev = false;
  }

  // Build spawns array for broadcast
  const spawnsArr = [];
  for (const [id, player] of players) {
    spawnsArr.push({ id, x: player.x, y: player.y, angle: player.angle, color: player.color });
  }

  // Broadcast newRound
  const msg = JSON.stringify({
    type: 'newRound',
    map: { rows: currentMap.rows, cols: currentMap.cols, hWalls: currentMap.hWalls, vWalls: currentMap.vWalls },
    spawns: spawnsArr,
  });
  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }

  tickInterval = setInterval(tick, 1000 / TICK_RATE);
  console.log(`New round started with ${players.size} player(s).`);
}

function broadcastState() {
  const playersArr = [];
  for (const [id, player] of players) {
    playersArr.push({
      id,
      x: player.x,
      y: player.y,
      angle: player.angle,
      hp: player.hp,
      alive: player.alive,
      color: player.color,
    });
  }

  const bulletsArr = bullets.map(b => ({
    x: b.x,
    y: b.y,
    ownerId: b.ownerId,
  }));

  const stateObj = {
    type: 'state',
    players: playersArr,
    bullets: bulletsArr,
  };
  if (frameHits.length > 0) {
    stateObj.hits = frameHits;
  }
  const msg = JSON.stringify(stateObj);

  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }
}

// --- Helper: get colors map ---
function getColorsMap() {
  const colors = {};
  for (const [id, player] of players) {
    colors[id] = player.color;
  }
  return colors;
}

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;
  const colorIndex = players.size;
  const color = assignColor(colorIndex);

  players.set(playerId, {
    ws,
    color,
    input: { w: false, a: false, s: false, d: false, space: false },
    alive: true,
    hp: TANK_HP,
    x: 0,
    y: 0,
    angle: 0,
    spacePrev: false,
    msgTimestamps: [],
  });

  // Initialize score if not present
  if (scores[playerId] === undefined) {
    scores[playerId] = 0;
  }

  console.log(`Player ${playerId} connected (${color}). Total: ${players.size}`);

  // Send init message
  ws.send(JSON.stringify({
    type: 'init',
    playerId,
    colors: getColorsMap(),
  }));

  // Notify existing players about the new color map
  const colorsUpdate = JSON.stringify({ type: 'playerJoined', colors: getColorsMap() });
  for (const [id, player] of players) {
    if (id !== playerId && player.ws.readyState === 1) {
      player.ws.send(colorsUpdate);
    }
  }

  ws.on('message', (data) => {
    const player = players.get(playerId);
    if (!player) return;

    // Rate limiting: 120 msg/s
    const now = Date.now();
    player.msgTimestamps.push(now);
    // Keep only timestamps from the last second
    player.msgTimestamps = player.msgTimestamps.filter(t => now - t < 1000);
    if (player.msgTimestamps.length > MSG_RATE_LIMIT) {
      return; // drop excess
    }

    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (!msg || !msg.type) return;

    if (msg.type === 'input' && msg.keys) {
      player.input = {
        w: !!msg.keys.w,
        a: !!msg.keys.a,
        s: !!msg.keys.s,
        d: !!msg.keys.d,
        space: !!msg.keys.space,
      };
    }

    if (msg.type === 'rematch' && gameState === 'roundEnd') {
      rematchVotes.add(playerId);
      console.log(`Player ${playerId} voted for rematch. Votes: ${rematchVotes.size}/${players.size}`);

      // Broadcast rematch vote status
      const voteMsg = JSON.stringify({
        type: 'rematch',
        votes: Array.from(rematchVotes),
      });
      for (const [id, p] of players) {
        if (p.ws.readyState === 1) {
          p.ws.send(voteMsg);
        }
      }

      // Check if rematch should trigger immediately
      // Host = first connected player (lowest ID)
      const hostId = Math.min(...Array.from(players.keys()));
      const allNonHostVoted = Array.from(players.keys())
        .filter(id => id !== hostId)
        .every(id => rematchVotes.has(id));

      if (rematchVotes.has(hostId) || (players.size > 1 && allNonHostVoted)) {
        console.log('Rematch vote passed! Starting new round immediately.');
        if (roundEndTimer) {
          clearTimeout(roundEndTimer);
          roundEndTimer = null;
        }
        if (players.size >= 2) {
          startNewRound();
        } else {
          gameState = 'lobby';
          console.log('Not enough players for new round. Returning to lobby.');
        }
      }
    }
  });

  ws.on('close', () => {
    console.log(`Player ${playerId} disconnected. Total: ${players.size - 1}`);

    if (gameState === 'lobby') {
      players.delete(playerId);
      // Broadcast updated player list / colors
      const colorsMsg = JSON.stringify({ type: 'playerJoined', colors: getColorsMap() });
      for (const [id, p] of players) {
        if (p.ws.readyState === 1) {
          p.ws.send(colorsMsg);
        }
      }
    } else if (gameState === 'playing') {
      // Mark as dead, don't remove (bullets stay, score persists)
      const player = players.get(playerId);
      if (player) {
        player.alive = false;
        console.log(`Player ${playerId} died (disconnected during play).`);
      }
      players.delete(playerId);

      if (players.size === 0) {
        stopGame();
        return;
      }

      // Check if round should end (<=1 alive among remaining players)
      let aliveCount = 0;
      let lastAliveId = null;
      for (const [id, p] of players) {
        if (p.alive) {
          aliveCount++;
          lastAliveId = id;
        }
      }
      if (aliveCount <= 1) {
        const winnerId = aliveCount === 1 ? lastAliveId : null;
        endRound(winnerId);
      }
    } else if (gameState === 'roundEnd') {
      players.delete(playerId);
      rematchVotes.delete(playerId);

      if (players.size === 0) {
        // All players disconnected, reset
        if (roundEndTimer) {
          clearTimeout(roundEndTimer);
          roundEndTimer = null;
        }
        gameState = 'lobby';
        console.log('All players disconnected. Returning to lobby.');
        return;
      }

      // Re-evaluate rematch conditions
      const hostId = Math.min(...Array.from(players.keys()));
      const allNonHostVoted = Array.from(players.keys())
        .filter(id => id !== hostId)
        .every(id => rematchVotes.has(id));

      if (rematchVotes.has(hostId) || (players.size > 1 && allNonHostVoted)) {
        console.log('Rematch vote passed after disconnect! Starting new round immediately.');
        if (roundEndTimer) {
          clearTimeout(roundEndTimer);
          roundEndTimer = null;
        }
        if (players.size >= 2) {
          startNewRound();
        } else {
          gameState = 'lobby';
          console.log('Not enough players for new round. Returning to lobby.');
        }
      }
    }
  });
});

// --- Game Flow ---
function startGame() {
  if (players.size < 2) {
    console.log('Need at least 2 players to start. Cannot start.');
    return;
  }

  // Cancel any pending round end timer
  if (roundEndTimer) {
    clearTimeout(roundEndTimer);
    roundEndTimer = null;
  }

  gameState = 'playing';
  bullets = [];
  currentMap = generateMap(players.size);
  const spawns = spawnPlayers(currentMap, players);
  debugPrintMap(currentMap, spawns);

  // Initialize player game state
  for (const [id, player] of players) {
    player.hp = TANK_HP;
    player.alive = true;
    player.spacePrev = false;
  }

  // Build spawns array for broadcast
  const spawnsArr = [];
  for (const [id, player] of players) {
    spawnsArr.push({ id, x: player.x, y: player.y, angle: player.angle, color: player.color });
  }

  // Send newRound to all clients
  const roundMsg = JSON.stringify({
    type: 'newRound',
    map: { rows: currentMap.rows, cols: currentMap.cols, hWalls: currentMap.hWalls, vWalls: currentMap.vWalls },
    spawns: spawnsArr,
  });
  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(roundMsg);
    }
  }

  tickInterval = setInterval(tick, 1000 / TICK_RATE);
  console.log(`Game started with ${players.size} player(s).`);
}

function stopGame() {
  gameState = 'lobby';
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  if (roundEndTimer) {
    clearTimeout(roundEndTimer);
    roundEndTimer = null;
  }
  bullets = [];
  currentMap = null;
  rematchVotes = new Set();
  console.log('Round ended. Returning to lobby.');
}

function fullRestart() {
  // Full restart: clear all state, disconnect all clients, return to lobby
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  if (roundEndTimer) {
    clearTimeout(roundEndTimer);
    roundEndTimer = null;
  }
  gameState = 'lobby';
  bullets = [];
  currentMap = null;
  scores = {};
  rematchVotes = new Set();

  // Disconnect all WebSocket clients
  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.close();
    }
  }
  players = new Map();
  nextPlayerId = 1;
  console.log('Server restarted.');
}

// --- Terminal Keypress Listener ---
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    // Ctrl+C to exit
    if (key === '\u0003') {
      console.log('Shutting down...');
      process.exit();
    }
    if (key.toLowerCase() === 's') {
      if (gameState === 'lobby' || gameState === 'roundEnd') {
        console.log('Starting game...');
        startGame();
      } else {
        console.log(`Cannot start game in '${gameState}' state.`);
      }
    }
    if (key.toLowerCase() === 'r') {
      console.log('Full restart...');
      fullRestart();
    }
  });
}

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`AZ Tank Game server running on http://localhost:${PORT}`);
  console.log('Press S to start game, R to restart, Ctrl+C to quit.');
});
