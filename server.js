const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// --- Load Config ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
let cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

function reloadConfig() {
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    TICK_RATE = cfg.tickRate;
    MSG_RATE_LIMIT = cfg.msgRateLimit;
    PRESET_COLORS = cfg.colors;
    TANK_RADIUS = cfg.tankRadius;
    BULLET_RADIUS = cfg.bulletRadius;
    TANK_SPEED = cfg.tankSpeed;
    ROTATION_SPEED = cfg.rotationSpeed * Math.PI / 180;
    BULLET_SPEED = cfg.bulletSpeed;
    MAX_BOUNCES = cfg.maxBounces;
    TANK_HP = cfg.tankHP;
    MAX_PLAYERS = cfg.maxPlayers || 6;
    READY_THRESHOLD = cfg.readyThreshold || 0.67;
    READY_COUNTDOWN_MS = cfg.readyCountdownMs || 10000;
    MISSILE_SPEED = cfg.missileSpeed || 3.2;
    MISSILE_ARM_TIME = cfg.missileArmTime || 0.6;
    MISSILE_ARM_SPEED = cfg.missileArmSpeed || 5.4;
    MISSILE_MIN_TURN_RADIUS = cfg.missileMinTurnRadius || 0.8;
    MISSILE_ACCEL = cfg.missileAccel || 8;
    WIRELESS_MISSILE_SPEED = cfg.wirelessMissileSpeed || 4.5;
    WIRELESS_MISSILE_TURN_DIAMETER = cfg.wirelessMissileTurnDiameter || 0.75;
    WIRELESS_MISSILE_LIFETIME = cfg.wirelessMissileLifetime || 12;
    MISSILE_RADIUS = cfg.missileRadius || 0.15;
    MISSILE_LIFETIME = cfg.missileLifetime || 12;
    MISSILE_RETARGET_INTERVAL = cfg.missileRetargetInterval || 1;
    POWERUP_SPAWN_INTERVAL = cfg.powerUpSpawnInterval || 10;
    POWERUP_RADIUS = cfg.powerUpRadius || 0.3;
    MAX_POWERUPS = cfg.maxPowerUps || 3;
    LANDMINE_ARM_TIME = cfg.landmineArmTime || 1;
    LANDMINE_FADE_TIME = cfg.landmineFadeTime || 2;
    LANDMINE_RADIUS = cfg.landmineRadius || 0.18;
    ICE_ARM_TIME = cfg.iceArmTime || cfg.iceVisibleTime || 1;
    ICE_FADE_TIME = cfg.iceFadeTime || 2;
    ICE_EFFECT_DURATION = cfg.iceEffectDuration || 3;
    ICE_TRACTION = cfg.iceTraction || 0.05;
    ICE_TURN_TRACTION = cfg.iceTurnTraction || 1.5;
    ICE_RADIUS = cfg.iceRadius || 0.2;
    console.log('Config reloaded.');
  } catch (e) {
    console.error('Failed to reload config:', e.message);
  }
}

// --- Constants (from config) ---
const PORT = cfg.port; // port can't change at runtime
let TICK_RATE = cfg.tickRate;
let MSG_RATE_LIMIT = cfg.msgRateLimit;
let PRESET_COLORS = cfg.colors;
let MAX_PLAYERS = cfg.maxPlayers || 6;
let READY_THRESHOLD = cfg.readyThreshold || 0.67;
let READY_COUNTDOWN_MS = cfg.readyCountdownMs || 10000;

// --- Physics Constants (from config) ---
let TANK_RADIUS = cfg.tankRadius;
let BULLET_RADIUS = cfg.bulletRadius;
let TANK_SPEED = cfg.tankSpeed;
let ROTATION_SPEED = cfg.rotationSpeed * Math.PI / 180; // config is degrees/s
let BULLET_SPEED = cfg.bulletSpeed;
let MAX_BOUNCES = cfg.maxBounces;
let TANK_HP = cfg.tankHP;
let MISSILE_SPEED = cfg.missileSpeed || 3.2;
let MISSILE_ARM_TIME = cfg.missileArmTime || 0.6;
let MISSILE_ARM_SPEED = cfg.missileArmSpeed || 5.4;
let MISSILE_MIN_TURN_RADIUS = cfg.missileMinTurnRadius || 0.8;
let MISSILE_ACCEL = cfg.missileAccel || 8;
let WIRELESS_MISSILE_SPEED = cfg.wirelessMissileSpeed || 4.5;
let WIRELESS_MISSILE_TURN_DIAMETER = cfg.wirelessMissileTurnDiameter || 0.75;
let WIRELESS_MISSILE_LIFETIME = cfg.wirelessMissileLifetime || 12;
let MISSILE_RADIUS = cfg.missileRadius || 0.15;
let MISSILE_LIFETIME = cfg.missileLifetime || 12;
let MISSILE_RETARGET_INTERVAL = cfg.missileRetargetInterval || 1;
let POWERUP_SPAWN_INTERVAL = cfg.powerUpSpawnInterval || 10;
let POWERUP_RADIUS = cfg.powerUpRadius || 0.3;
let MAX_POWERUPS = cfg.maxPowerUps || 3;
let LANDMINE_ARM_TIME = cfg.landmineArmTime || 1;
let LANDMINE_FADE_TIME = cfg.landmineFadeTime || 2;
let LANDMINE_RADIUS = cfg.landmineRadius || 0.18;
let ICE_ARM_TIME = cfg.iceArmTime || cfg.iceVisibleTime || 1;
let ICE_FADE_TIME = cfg.iceFadeTime || 2;
let ICE_EFFECT_DURATION = cfg.iceEffectDuration || 3;
let ICE_TRACTION = cfg.iceTraction || 0.05;
let ICE_TURN_TRACTION = cfg.iceTurnTraction || 1.5;
let ICE_RADIUS = cfg.iceRadius || 0.2;

// --- Game State ---
let gameState = 'lobby'; // lobby | playing | roundEnd
let players = new Map();  // id -> { ws, color, name, ready, input, alive, msgTimestamps, x, y, angle, hp, spacePrev }
let tickInterval = null;
let bullets = [];          // { ownerId, x, y, dx, dy, bouncesLeft }
let currentMap = null;
let scores = {};           // playerId -> number of wins
let readyCountdownTimer = null; // timer for ready-based start
let rematchVotes = new Set();
let roundEndTimer = null;  // 5-second auto-restart timer
let powerUps = [];         // { id, x, y, type, angle }
let missiles = [];         // { id, ownerId, x, y, vx, vy, targetId, retargetTimer, lifetime }
let wirelessMissiles = []; // { id, pilotId, x, y, angle, lifetime }
let nextPowerUpId = 1;
let nextMissileId = 1;
let nextWirelessMissileId = 1;
let nextLandmineId = 1;
let nextIceTrapId = 1;
let powerUpSpawnTimer = 0;
let landmines = [];        // { id, x, y, ownerId, armTimer }
let iceTraps = [];         // { id, x, y, ownerId, visibleTimer }

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
  const size = cfg.gridBaseSize + cfg.gridPerPlayer * playerCount;
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
  const removeCount = Math.floor(interiorWalls.length * cfg.wallRemovalPercent);
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

// --- BFS next waypoint (for missile pathfinding) ---
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

// --- Missile target selection ---
function selectMissileTarget(missile, map) {
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

// --- Power-up spawning ---
function spawnPowerUp(map) {
  const { rows, cols } = map;
  for (let attempt = 0; attempt < 20; attempt++) {
    const c = Math.floor(Math.random() * cols);
    const r = Math.floor(Math.random() * rows);
    const x = c + 0.5;
    const y = r + 0.5;

    let tooClose = false;
    for (const [id, player] of players) {
      if (!player.alive) continue;
      if (Math.hypot(x - player.x, y - player.y) < 2) { tooClose = true; break; }
    }
    if (!tooClose) {
      for (const pu of powerUps) {
        if (Math.hypot(x - pu.x, y - pu.y) < 2) { tooClose = true; break; }
      }
    }
    if (!tooClose) {
      const types = [];
      if (cfg.spawnMissile !== false)         types.push('missile');
      if (cfg.spawnWirelessMissile !== false)  types.push('wirelessMissile');
      if (cfg.spawnLandmine !== false)         types.push('landmine');
      if (cfg.spawnIce !== false)              types.push('ice');
      if (types.length === 0) return;
      powerUps.push({
        id: nextPowerUpId++,
        x, y,
        type: types[Math.floor(Math.random() * types.length)],
        angle: Math.random() * Math.PI * 2,
      });
      return;
    }
  }
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

// Raycast a thin point ray from tank center to bullet spawn point.
// Checks every wall between start and end. If a wall is crossed,
// returns the spawn position BEFORE the wall (offset by bulletRadius)
// and which wall type was hit.
// Returns {x, y, type: 'h'|'v'} or null if path is clear.
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

let frameHits = []; // [{x, y}] - bullet impact positions this tick
let frameDeaths = []; // [{x, y, color}] - tank death positions this tick
let lastTickTime = 0;

function tick() {
  if (!currentMap) return;
  const now = performance.now();
  const DT = lastTickTime ? Math.min((now - lastTickTime) / 1000, 0.05) : 1 / 60; // cap at 50ms
  lastTickTime = now;
  const map = currentMap;
  frameHits = [];
  frameDeaths = [];

  // --- Tank Movement ---
  for (const [id, player] of players) {
    if (!player.alive) continue;
    if (player.pilotingMissileId !== null) {
      player.spacePrev = player.input.space;
      continue; // Input is consumed by wireless missile tick
    }
    const keys = player.input;

    // Desired rotation and movement
    let desiredAngVel = 0;
    if (keys.a) desiredAngVel = -ROTATION_SPEED;
    if (keys.d) desiredAngVel = ROTATION_SPEED;

    let desiredVx = 0, desiredVy = 0;
    if (keys.w) {
      desiredVx = Math.cos(player.angle) * TANK_SPEED;
      desiredVy = Math.sin(player.angle) * TANK_SPEED;
    } else if (keys.s) {
      desiredVx = -Math.cos(player.angle) * TANK_SPEED;
      desiredVy = -Math.sin(player.angle) * TANK_SPEED;
    }

    if (player.iceTimer > 0) {
      player.iceTimer -= DT;
      // Preserve velocity (very low traction = barely slows down)
      player.vx += (desiredVx - player.vx) * ICE_TRACTION * DT;
      player.vy += (desiredVy - player.vy) * ICE_TRACTION * DT;
      // Turn speed is slow but responsive enough to be controllable
      player.angularVel += (desiredAngVel - player.angularVel) * ICE_TURN_TRACTION * DT;
    } else {
      player.vx = desiredVx;
      player.vy = desiredVy;
      player.angularVel = desiredAngVel;
    }

    player.angle += player.angularVel * DT;

    const dx = player.vx * DT;
    const dy = player.vy * DT;

    if (dx !== 0 || dy !== 0) {
      const resolved = resolveTankCollision(player.x + dx, player.y + dy, TANK_RADIUS, map);
      player.x = resolved.x;
      player.y = resolved.y;
    }

    // --- Firing (edge trigger) ---
    if (keys.space && !player.spacePrev) {
      if (player.powerUp === 'missile') {
        const cosA = Math.cos(player.angle);
        const sinA = Math.sin(player.angle);
        const spawnDist = cfg.barrelLength + 0.15;
        missiles.push({
          id: nextMissileId++,
          ownerId: id,
          x: player.x + cosA * spawnDist,
          y: player.y + sinA * spawnDist,
          vx: cosA * MISSILE_ARM_SPEED,
          vy: sinA * MISSILE_ARM_SPEED,
          targetId: null,
          retargetTimer: 0,
          lifetime: MISSILE_LIFETIME,
          armTimer: MISSILE_ARM_TIME,
        });
        player.powerUp = null;
      } else if (player.powerUp === 'landmine') {
        landmines.push({
          id: nextLandmineId++,
          x: player.x,
          y: player.y,
          ownerId: id,
          armTimer: LANDMINE_ARM_TIME,
          fadeTimer: LANDMINE_FADE_TIME,
        });
        player.powerUp = null;
      } else if (player.powerUp === 'ice') {
        iceTraps.push({
          id: nextIceTrapId++,
          x: player.x,
          y: player.y,
          ownerId: id,
          armTimer: ICE_ARM_TIME,
          fadeTimer: ICE_FADE_TIME,
        });
        player.powerUp = null;
      } else if (player.powerUp === 'wirelessMissile') {
        const cosA = Math.cos(player.angle);
        const sinA = Math.sin(player.angle);
        const spawnDist = cfg.barrelLength + 0.15;
        const wm = {
          id: nextWirelessMissileId++,
          pilotId: id,
          x: player.x + cosA * spawnDist,
          y: player.y + sinA * spawnDist,
          angle: player.angle,
          lifetime: WIRELESS_MISSILE_LIFETIME,
        };
        wirelessMissiles.push(wm);
        player.pilotingMissileId = wm.id;
        player.powerUp = null;
      } else {
        // Check if player has no active bullet
        const hasActiveBullet = bullets.some(b => b.ownerId === id);
        if (!hasActiveBullet) {
          const cosA = Math.cos(player.angle);
          const sinA = Math.sin(player.angle);
          let bdx = cosA * BULLET_SPEED;
          let bdy = sinA * BULLET_SPEED;

          // Raycast from tank center toward barrel tip to find first wall hit
          const spawnDist = cfg.barrelLength;
          const tipX = player.x + cosA * spawnDist;
          const tipY = player.y + sinA * spawnDist;
          const hit = raycastBulletSpawn(player.x, player.y, tipX, tipY, BULLET_RADIUS, map);

          let bx, by;
          if (hit) {
            bx = hit.x;
            by = hit.y;
            if (hit.type === 'h') {
              bdy = -bdy;
            } else {
              bdx = -bdx;
            }
          } else {
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
    }
    player.spacePrev = keys.space;
  }

  // --- Bullet Movement & Wall Bouncing (substep + normal-based reflection) ---
  // Wall segments are inset at perpendicular corners so bullets hit the flat
  // face of the wall rather than the shared corner point (which would reflect
  // back toward the shooter instead of at the correct angle).
  const WALL_INSET = 0.06;

  // Find closest point on segment to circle center, return {cx, cy, dist}
  function closestPointOnSeg(px, py, x1, y1, x2, y2) {
    const abx = x2 - x1, aby = y2 - y1;
    const acx = px - x1, acy = py - y1;
    const ab2 = abx * abx + aby * aby;
    const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (acx * abx + acy * aby) / ab2));
    const cx = x1 + t * abx, cy = y1 + t * aby;
    return { cx, cy, dist: Math.hypot(px - cx, py - cy) };
  }

  // Check if a perpendicular wall exists at a horizontal wall's endpoint
  function hWallHasCorner(row, col, hWalls, vWalls, rows, cols) {
    // col is the x-coordinate of the endpoint. Check vertical walls meeting there.
    if (col >= 0 && col <= cols) {
      // vWall above: vWalls[row-1][col] spans (col, row-1) to (col, row)
      if (row > 0 && vWalls[row - 1] && vWalls[row - 1][col]) return true;
      // vWall below: vWalls[row][col] spans (col, row) to (col, row+1)
      if (row < rows && vWalls[row] && vWalls[row][col]) return true;
    }
    return false;
  }

  // Check if a perpendicular wall exists at a vertical wall's endpoint
  function vWallHasCorner(row, col, hWalls, vWalls, rows, cols) {
    // row is the y-coordinate of the endpoint. Check horizontal walls meeting there.
    if (row >= 0 && row <= rows) {
      // hWall to left: hWalls[row][col-1] spans (col-1, row) to (col, row)
      if (col > 0 && hWalls[row] && hWalls[row][col - 1]) return true;
      // hWall to right: hWalls[row][col] spans (col, row) to (col+1, row)
      if (col < cols && hWalls[row] && hWalls[row][col]) return true;
    }
    return false;
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const { rows, cols, hWalls, vWalls } = map;

    // Substep: steps no larger than ~90% of bullet radius
    const moveX = b.dx * DT;
    const moveY = b.dy * DT;
    const moveDist = Math.sqrt(moveX * moveX + moveY * moveY);
    const maxStep = BULLET_RADIUS * 0.9;
    const numSteps = Math.max(1, Math.ceil(moveDist / maxStep));
    const stepX = moveX / numSteps;
    const stepY = moveY / numSteps;

    let destroyed = false;
    for (let step = 0; step < numSteps; step++) {
      b.x += stepX;
      b.y += stepY;

      // Find the deepest penetrating wall collision
      let bestDist = Infinity;
      let bestCx = 0, bestCy = 0; // closest point on wall to bullet center

      const minRow = Math.max(0, Math.floor(b.y - 1));
      const maxRow = Math.min(rows, Math.floor(b.y + 1) + 1);
      const minCol = Math.max(0, Math.floor(b.x - 1));
      const maxCol = Math.min(cols, Math.floor(b.x + 1) + 1);

      // Horizontal walls
      for (let row = minRow; row <= maxRow; row++) {
        for (let c = minCol; c <= Math.min(cols - 1, maxCol); c++) {
          if (row > rows || c >= cols) continue;
          if (!hWalls[row] || !hWalls[row][c]) continue;
          // Inset at corners with perpendicular walls
          const li = hWallHasCorner(row, c, hWalls, vWalls, rows, cols) ? WALL_INSET : 0;
          const ri = hWallHasCorner(row, c + 1, hWalls, vWalls, rows, cols) ? WALL_INSET : 0;
          const cp = closestPointOnSeg(b.x, b.y, c + li, row, c + 1 - ri, row);
          if (cp.dist < BULLET_RADIUS && cp.dist < bestDist) {
            bestDist = cp.dist;
            bestCx = cp.cx;
            bestCy = cp.cy;
          }
        }
      }

      // Vertical walls
      for (let c = minCol; c <= maxCol; c++) {
        for (let row = minRow; row <= Math.min(rows - 1, maxRow); row++) {
          if (c > cols || row >= rows) continue;
          if (!vWalls[row] || !vWalls[row][c]) continue;
          // Inset at corners with perpendicular walls
          const ti = vWallHasCorner(row, c, hWalls, vWalls, rows, cols) ? WALL_INSET : 0;
          const bi = vWallHasCorner(row + 1, c, hWalls, vWalls, rows, cols) ? WALL_INSET : 0;
          const cp = closestPointOnSeg(b.x, b.y, c, row + ti, c, row + 1 - bi);
          if (cp.dist < BULLET_RADIUS && cp.dist < bestDist) {
            bestDist = cp.dist;
            bestCx = cp.cx;
            bestCy = cp.cy;
          }
        }
      }

      if (bestDist < BULLET_RADIUS) {
        frameHits.push({ x: b.x, y: b.y });
        b.bouncesLeft--;
        if (b.bouncesLeft < 0) {
          bullets.splice(i, 1);
          destroyed = true;
          break;
        }

        // Normal: from closest wall point toward bullet center
        let nx = b.x - bestCx;
        let ny = b.y - bestCy;
        const nLen = Math.hypot(nx, ny);
        if (nLen > 0.0001) {
          nx /= nLen;
          ny /= nLen;
        } else {
          // Bullet center is exactly on the wall — use velocity to determine push direction
          nx = -b.dx;
          ny = -b.dy;
          const vLen = Math.hypot(nx, ny);
          if (vLen > 0) { nx /= vLen; ny /= vLen; }
        }

        // Reflect velocity: v' = v - 2(v·n)n
        const dot = b.dx * nx + b.dy * ny;
        b.dx -= 2 * dot * nx;
        b.dy -= 2 * dot * ny;

        // Push bullet out of wall along normal
        b.x = bestCx + nx * BULLET_RADIUS;
        b.y = bestCy + ny * BULLET_RADIUS;

        // After a bounce, skip remaining substeps (prevents double-bounce glitches)
        break;
      }
    }
    if (destroyed) continue;

    // Safety clamp
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
          frameDeaths.push({ x: player.x, y: player.y, color: player.color });
        }
        bullets.splice(i, 1);
        break; // bullet is gone, move to next
      }
    }
  }

  // --- Power-up spawning ---
  powerUpSpawnTimer -= DT;
  if (powerUpSpawnTimer <= 0 && powerUps.length < MAX_POWERUPS) {
    spawnPowerUp(map);
    powerUpSpawnTimer = POWERUP_SPAWN_INTERVAL;
  }

  // --- Power-up pickup ---
  for (let i = powerUps.length - 1; i >= 0; i--) {
    const pu = powerUps[i];
    for (const [id, player] of players) {
      if (!player.alive) continue;
      if (player.powerUp) continue; // already holding one
      const dist = Math.hypot(pu.x - player.x, pu.y - player.y);
      if (dist < POWERUP_RADIUS + TANK_RADIUS) {
        player.powerUp = pu.type;
        powerUps.splice(i, 1);
        break;
      }
    }
  }

  // --- Missile update ---
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.lifetime -= DT;
    if (m.lifetime <= 0) {
      frameDeaths.push({ x: m.x, y: m.y, color: '#888888' });
      missiles.splice(i, 1);
      continue;
    }

    // Arm timer — travel straight like a bullet before activating
    const armed = m.armTimer <= 0;
    if (!armed) {
      m.armTimer -= DT;
    }

    if (armed) {
      // Retarget
      m.retargetTimer -= DT;
      if (m.retargetTimer <= 0 || m.targetId === null) {
        m.targetId = selectMissileTarget(m, map);
        m.retargetTimer = MISSILE_RETARGET_INTERVAL;
      }

      // Validate target
      if (m.targetId !== null) {
        const target = players.get(m.targetId);
        if (!target || !target.alive) {
          m.targetId = selectMissileTarget(m, map);
          m.retargetTimer = MISSILE_RETARGET_INTERVAL;
        }
      }

      // No targets left — self-destruct
      if (m.targetId === null) {
        frameDeaths.push({ x: m.x, y: m.y, color: '#888888' });
        missiles.splice(i, 1);
        continue;
      }

      // Steer toward target via BFS pathfinding with min turn radius
      const target = players.get(m.targetId);
      if (target) {
        const waypoint = bfsNextWaypoint(map, m.x, m.y, target.x, target.y);
        const dx = waypoint.x - m.x;
        const dy = waypoint.y - m.y;
        if (Math.hypot(dx, dy) > 0.01) {
          const desiredAngle = Math.atan2(dy, dx);
          const currentAngle = Math.atan2(m.vy, m.vx);
          let angleDiff = desiredAngle - currentAngle;
          while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
          // Max turn rate from min turn radius: ω = v / r
          const maxDelta = (MISSILE_SPEED / MISSILE_MIN_TURN_RADIUS) * DT;
          const newAngle = currentAngle + Math.max(-maxDelta, Math.min(maxDelta, angleDiff));
          const spd = Math.hypot(m.vx, m.vy);
          m.vx = Math.cos(newAngle) * spd;
          m.vy = Math.sin(newAngle) * spd;
        }
      }
    }

    // Normalize to target speed (arm phase uses arm speed, homing uses missile speed)
    const speed = Math.hypot(m.vx, m.vy);
    if (speed > 0) {
      const targetSpeed = armed ? MISSILE_SPEED : MISSILE_ARM_SPEED;
      m.vx = m.vx / speed * targetSpeed;
      m.vy = m.vy / speed * targetSpeed;
    }

    // Move
    m.x += m.vx * DT;
    m.y += m.vy * DT;

    // Wall collision (bounce while unarmed, resolve while armed)
    if (!armed) {
      // Bounce off walls like a bullet during arm phase
      const wallHit = findFirstWallCollision(m.x, m.y, MISSILE_RADIUS, map);
      if (wallHit) {
        if (wallHit.type === 'h') m.vy = -m.vy;
        else m.vx = -m.vx;
        const resolved = resolveTankCollision(m.x, m.y, MISSILE_RADIUS, map);
        m.x = resolved.x;
        m.y = resolved.y;
      }
    } else {
      const oldMx = m.x, oldMy = m.y;
      const resolved = resolveTankCollision(m.x, m.y, MISSILE_RADIUS, map);
      m.x = resolved.x;
      m.y = resolved.y;

      // If wall pushed the missile, cancel velocity going into that wall
      const pushX = m.x - oldMx;
      const pushY = m.y - oldMy;
      const pushDist = Math.hypot(pushX, pushY);
      if (pushDist > 0.001) {
        const nx = pushX / pushDist;
        const ny = pushY / pushDist;
        const vDot = m.vx * nx + m.vy * ny;
        if (vDot < 0) {
          m.vx -= vDot * nx;
          m.vy -= vDot * ny;
        }
      }
    }

    // Tank collision (only when armed)
    let missileDestroyed = false;
    if (armed) {
      for (const [id, player] of players) {
        if (!player.alive) continue;
        const dist = Math.hypot(m.x - player.x, m.y - player.y);
        if (dist < MISSILE_RADIUS + TANK_RADIUS) {
          player.hp--;
          if (player.hp <= 0) {
            player.alive = false;
            frameDeaths.push({ x: player.x, y: player.y, color: player.color });
          }
          frameHits.push({ x: m.x, y: m.y });
          missiles.splice(i, 1);
          missileDestroyed = true;
          break;
        }
      }
    }
    if (missileDestroyed) continue;
  }

  // --- Landmine update ---
  for (let i = landmines.length - 1; i >= 0; i--) {
    const lm = landmines[i];
    if (lm.armTimer > 0) {
      lm.armTimer -= DT;
      continue; // Still arming, not yet dangerous
    }
    // Armed — count down fade timer
    if (lm.fadeTimer > 0) lm.fadeTimer -= DT;
    // Check tank collision (always armed, even when invisible)
    let destroyed = false;
    for (const [id, player] of players) {
      if (!player.alive) continue;
      const dist = Math.hypot(lm.x - player.x, lm.y - player.y);
      if (dist < LANDMINE_RADIUS + TANK_RADIUS) {
        player.hp--;
        if (player.hp <= 0) {
          player.alive = false;
          frameDeaths.push({ x: player.x, y: player.y, color: player.color });
        }
        frameHits.push({ x: lm.x, y: lm.y });
        frameDeaths.push({ x: lm.x, y: lm.y, color: '#888888' });
        landmines.splice(i, 1);
        destroyed = true;
        break;
      }
    }
    if (destroyed) continue;
  }

  // --- Ice trap update ---
  for (let i = iceTraps.length - 1; i >= 0; i--) {
    const it = iceTraps[i];
    if (it.armTimer > 0) {
      it.armTimer -= DT;
      continue; // Still deploying, not yet active
    }
    // Armed — count down fade timer
    if (it.fadeTimer > 0) it.fadeTimer -= DT;
    // Check tank collision (always active, even when invisible)
    let destroyed = false;
    for (const [id, player] of players) {
      if (!player.alive) continue;
      const dist = Math.hypot(it.x - player.x, it.y - player.y);
      if (dist < ICE_RADIUS + TANK_RADIUS) {
        player.iceTimer = ICE_EFFECT_DURATION;
        iceTraps.splice(i, 1);
        destroyed = true;
        break;
      }
    }
    if (destroyed) continue;
  }

  // --- Wireless Missile update ---
  for (let i = wirelessMissiles.length - 1; i >= 0; i--) {
    const wm = wirelessMissiles[i];
    wm.lifetime -= DT;
    const pilot = players.get(wm.pilotId);

    // Destroy if pilot gone/dead or lifetime expired
    if (!pilot || !pilot.alive || wm.lifetime <= 0) {
      frameDeaths.push({ x: wm.x, y: wm.y, color: pilot ? pilot.color : '#888888' });
      if (pilot) pilot.pilotingMissileId = null;
      wirelessMissiles.splice(i, 1);
      continue;
    }

    // Steer from pilot input — instant, no inertia
    const keys = pilot.input;
    const turnRadius = WIRELESS_MISSILE_TURN_DIAMETER / 2;
    const maxTurnRate = WIRELESS_MISSILE_SPEED / turnRadius; // rad/s
    if (keys.a) wm.angle -= maxTurnRate * DT;
    if (keys.d) wm.angle += maxTurnRate * DT;

    // Move forward
    wm.x += Math.cos(wm.angle) * WIRELESS_MISSILE_SPEED * DT;
    wm.y += Math.sin(wm.angle) * WIRELESS_MISSILE_SPEED * DT;

    // Bounce off walls
    const wallHit = findFirstWallCollision(wm.x, wm.y, MISSILE_RADIUS, map);
    if (wallHit) {
      if (wallHit.type === 'h') wm.angle = -wm.angle;
      else wm.angle = Math.PI - wm.angle;
      const resolved = resolveTankCollision(wm.x, wm.y, MISSILE_RADIUS, map);
      wm.x = resolved.x;
      wm.y = resolved.y;
    }

    // Tank collision — skip pilot
    let wmDestroyed = false;
    for (const [tid, target] of players) {
      if (tid === wm.pilotId || !target.alive) continue;
      if (Math.hypot(wm.x - target.x, wm.y - target.y) < MISSILE_RADIUS + TANK_RADIUS) {
        target.hp--;
        if (target.hp <= 0) {
          target.alive = false;
          frameDeaths.push({ x: target.x, y: target.y, color: target.color });
        }
        frameHits.push({ x: wm.x, y: wm.y });
        frameDeaths.push({ x: wm.x, y: wm.y, color: pilot.color });
        pilot.pilotingMissileId = null;
        wirelessMissiles.splice(i, 1);
        wmDestroyed = true;
        break;
      }
    }
    if (wmDestroyed) continue;
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
      broadcastLobby();
    }
  }, cfg.roundEndDelay);
}

function startNewRound() {
  gameState = 'playing';
  bullets = [];
  powerUps = [];
  missiles = [];
  wirelessMissiles = [];
  landmines = [];
  iceTraps = [];
  powerUpSpawnTimer = POWERUP_SPAWN_INTERVAL;
  currentMap = generateMap(players.size);
  const spawns = spawnPlayers(currentMap, players);
  debugPrintMap(currentMap, spawns);

  // Initialize player game state
  for (const [id, player] of players) {
    player.hp = TANK_HP;
    player.alive = true;
    player.spacePrev = false;
    player.powerUp = null;
    player.pilotingMissileId = null;
    player.vx = 0; player.vy = 0; player.angularVel = 0;
    player.iceTimer = 0;
  }

  // Build spawns array for broadcast
  const spawnsArr = [];
  for (const [id, player] of players) {
    spawnsArr.push({ id, name: player.name, x: player.x, y: player.y, angle: player.angle, color: player.color });
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

  lastTickTime = 0;
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
      name: player.name,
      powerUp: player.powerUp || null,
      piloting: player.pilotingMissileId !== null,
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
  if (frameDeaths.length > 0) {
    stateObj.deaths = frameDeaths;
  }
  if (powerUps.length > 0) {
    stateObj.powerUps = powerUps.map(pu => ({
      id: pu.id, x: pu.x, y: pu.y, type: pu.type, angle: pu.angle,
    }));
  }
  if (missiles.length > 0) {
    stateObj.missiles = missiles.map(m => ({
      id: m.id, x: m.x, y: m.y,
      angle: Math.atan2(m.vy, m.vx),
      ownerId: m.ownerId,
      targetId: m.targetId,
    }));
  }
  if (wirelessMissiles.length > 0) {
    stateObj.wirelessMissiles = wirelessMissiles.map(wm => ({
      id: wm.id, x: wm.x, y: wm.y, angle: wm.angle,
      ownerId: wm.pilotId,
      color: players.get(wm.pilotId)?.color || '#888888',
    }));
  }
  const visibleLandmines = landmines.filter(lm => lm.armTimer > 0 || lm.fadeTimer > 0);
  if (visibleLandmines.length > 0) {
    stateObj.landmines = visibleLandmines.map(lm => ({
      id: lm.id, x: lm.x, y: lm.y,
      armed: lm.armTimer <= 0,
      alpha: lm.armTimer > 0 ? 1 : Math.max(0, lm.fadeTimer / LANDMINE_FADE_TIME),
    }));
  }
  const visibleIceTraps = iceTraps.filter(it => it.armTimer > 0 || it.fadeTimer > 0);
  if (visibleIceTraps.length > 0) {
    stateObj.iceTraps = visibleIceTraps.map(it => ({
      id: it.id, x: it.x, y: it.y,
      armed: it.armTimer <= 0,
      alpha: it.armTimer > 0 ? 1 : Math.max(0, it.fadeTimer / ICE_FADE_TIME),
    }));
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

function getLobbyState() {
  const lobbyPlayers = [];
  for (const [id, player] of players) {
    lobbyPlayers.push({ id, name: player.name, color: player.color, ready: player.ready });
  }
  return lobbyPlayers;
}

function broadcastLobby() {
  const msg = JSON.stringify({
    type: 'lobby',
    players: getLobbyState(),
    maxPlayers: MAX_PLAYERS,
  });
  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }
}

function checkReadyState() {
  if (gameState !== 'lobby') return;
  if (players.size < 2) {
    // Cancel any pending countdown
    if (readyCountdownTimer) {
      clearTimeout(readyCountdownTimer);
      readyCountdownTimer = null;
      broadcastLobby();
    }
    return;
  }

  const readyCount = Array.from(players.values()).filter(p => p.ready).length;
  const total = players.size;

  // All ready → start instantly
  if (readyCount === total) {
    if (readyCountdownTimer) {
      clearTimeout(readyCountdownTimer);
      readyCountdownTimer = null;
    }
    console.log('All players ready. Starting immediately.');
    startGame();
    return;
  }

  // Threshold met → start countdown (if not already running)
  if (readyCount / total >= READY_THRESHOLD) {
    if (!readyCountdownTimer) {
      console.log(`${readyCount}/${total} ready (>= ${(READY_THRESHOLD * 100).toFixed(0)}%). Starting countdown.`);
      const countdownStart = Date.now();
      // Broadcast countdown start
      const msg = JSON.stringify({ type: 'readyCountdown', endsAt: countdownStart + READY_COUNTDOWN_MS });
      for (const [id, p] of players) {
        if (p.ws.readyState === 1) p.ws.send(msg);
      }
      readyCountdownTimer = setTimeout(() => {
        readyCountdownTimer = null;
        if (gameState === 'lobby' && players.size >= 2) {
          console.log('Ready countdown finished. Starting game.');
          startGame();
        }
      }, READY_COUNTDOWN_MS);
    }
  } else {
    // Below threshold → cancel countdown
    if (readyCountdownTimer) {
      clearTimeout(readyCountdownTimer);
      readyCountdownTimer = null;
      console.log('Ready count dropped below threshold. Countdown cancelled.');
      const msg = JSON.stringify({ type: 'readyCountdown', endsAt: null });
      for (const [id, p] of players) {
        if (p.ws.readyState === 1) p.ws.send(msg);
      }
    }
  }
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
  let playerId = null;
  let joined = false;

  // Send welcome with server info (before join)
  ws.send(JSON.stringify({
    type: 'welcome',
    maxPlayers: MAX_PLAYERS,
    currentPlayers: players.size,
    gameState,
  }));

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || !msg.type) return;

    // --- Join message (registers the player) ---
    if (msg.type === 'join' && !joined) {
      if (players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', message: 'Server is full.' }));
        ws.close();
        return;
      }

      let name = (typeof msg.name === 'string' && msg.name.trim()) ? msg.name.trim().slice(0, 16) : null;

      // Ensure unique name
      const takenNames = new Set(Array.from(players.values()).map(p => p.name.toLowerCase()));
      if (!name || takenNames.has(name.toLowerCase())) {
        ws.send(JSON.stringify({ type: 'error', message: 'That name is already taken.' }));
        return;
      }

      // All validation passed — commit
      playerId = 1;
      while (players.has(playerId)) playerId++;
      joined = true;

      // Assign lowest unused color index
      const usedColorIndices = new Set(Array.from(players.values()).map(p => p.colorIndex));
      let colorIndex = 0;
      while (usedColorIndices.has(colorIndex)) colorIndex++;
      const color = assignColor(colorIndex);

      const joinedMidMatch = gameState === 'playing';

      players.set(playerId, {
        ws,
        color,
        colorIndex,
        name,
        ready: false,
        input: { w: false, a: false, s: false, d: false, space: false },
        alive: !joinedMidMatch,
        hp: joinedMidMatch ? 0 : TANK_HP,
        x: 0,
        y: 0,
        angle: 0,
        spacePrev: false,
        powerUp: null,
        pilotingMissileId: null,
        vx: 0, vy: 0, angularVel: 0,
        iceTimer: 0,
        msgTimestamps: [],
      });

      if (scores[playerId] === undefined) {
        scores[playerId] = 0;
      }

      console.log(`${name} (P${playerId}) connected (${color}, colorIdx ${colorIndex})${joinedMidMatch ? ' [spectating]' : ''}. Total: ${players.size}`);

      // Send init
      ws.send(JSON.stringify({
        type: 'init',
        playerId,
        colors: getColorsMap(),
        names: Object.fromEntries(Array.from(players.entries()).map(([id, p]) => [id, p.name])),
      }));

      // If joining mid-match, send map
      if (joinedMidMatch && currentMap) {
        ws.send(JSON.stringify({ type: 'newRound', map: currentMap }));
      }

      // Notify all players
      broadcastLobby();
      return;
    }

    // Everything below requires a joined player
    if (!joined) return;
    const player = players.get(playerId);
    if (!player) return;

    // Rate limiting
    const now = Date.now();
    player.msgTimestamps.push(now);
    player.msgTimestamps = player.msgTimestamps.filter(t => now - t < 1000);
    if (player.msgTimestamps.length > MSG_RATE_LIMIT) {
      return;
    }

    // --- Ready toggle ---
    if (msg.type === 'ready' && gameState === 'lobby') {
      player.ready = !player.ready;
      console.log(`${player.name} (P${playerId}) is ${player.ready ? 'ready' : 'not ready'}.`);
      broadcastLobby();
      checkReadyState();
      return;
    }

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
    if (!joined) return; // never fully joined, nothing to clean up
    console.log(`Player ${playerId} disconnected. Total: ${players.size - 1}`);

    // Clean up disconnected player's score
    delete scores[playerId];

    if (gameState === 'lobby') {
      players.delete(playerId);
      broadcastLobby();
      checkReadyState();
    } else if (gameState === 'playing') {
      // Mark as dead, don't remove (bullets stay)
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

      if (players.size < 2) {
        // Not enough players — cancel countdown and return to lobby
        if (roundEndTimer) {
          clearTimeout(roundEndTimer);
          roundEndTimer = null;
        }
        gameState = 'lobby';
        if (players.size === 0) {
          console.log('All players disconnected. Returning to lobby.');
        } else {
          console.log('Not enough players. Returning to lobby.');
          broadcastLobby();
        }
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
        startNewRound();
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

  // Cancel any pending timers
  if (roundEndTimer) {
    clearTimeout(roundEndTimer);
    roundEndTimer = null;
  }
  if (readyCountdownTimer) {
    clearTimeout(readyCountdownTimer);
    readyCountdownTimer = null;
  }

  // Reset ready states
  for (const [id, player] of players) {
    player.ready = false;
  }

  gameState = 'playing';
  bullets = [];
  powerUps = [];
  missiles = [];
  wirelessMissiles = [];
  landmines = [];
  iceTraps = [];
  powerUpSpawnTimer = POWERUP_SPAWN_INTERVAL;
  currentMap = generateMap(players.size);
  const spawns = spawnPlayers(currentMap, players);
  debugPrintMap(currentMap, spawns);

  // Initialize player game state
  for (const [id, player] of players) {
    player.hp = TANK_HP;
    player.alive = true;
    player.spacePrev = false;
    player.powerUp = null;
    player.pilotingMissileId = null;
    player.vx = 0; player.vy = 0; player.angularVel = 0;
    player.iceTimer = 0;
  }

  // Build spawns array for broadcast
  const spawnsArr = [];
  for (const [id, player] of players) {
    spawnsArr.push({ id, name: player.name, x: player.x, y: player.y, angle: player.angle, color: player.color });
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

  lastTickTime = 0;
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
  powerUps = [];
  missiles = [];
  wirelessMissiles = [];
  landmines = [];
  iceTraps = [];
  currentMap = null;
  rematchVotes = new Set();
  for (const [id, player] of players) {
    player.ready = false;
  }
  console.log('Round ended. Returning to lobby.');
  broadcastLobby();
}

function fullRestart() {
  // Reload config from disk
  reloadConfig();

  // Full restart: clear all state, disconnect all clients, return to lobby
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  if (roundEndTimer) {
    clearTimeout(roundEndTimer);
    roundEndTimer = null;
  }
  if (readyCountdownTimer) {
    clearTimeout(readyCountdownTimer);
    readyCountdownTimer = null;
  }
  gameState = 'lobby';
  bullets = [];
  powerUps = [];
  missiles = [];
  wirelessMissiles = [];
  landmines = [];
  iceTraps = [];
  currentMap = null;
  scores = {};
  rematchVotes = new Set();

  // Notify and disconnect all WebSocket clients
  const killMsg = JSON.stringify({ type: 'serverKill', reason: 'Server restarted.' });
  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(killMsg);
      player.ws.close();
    }
  }
  players = new Map();
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
      gracefulShutdown();
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

// --- Graceful Shutdown ---
function gracefulShutdown() {
  console.log('Shutting down...');
  const killMsg = JSON.stringify({ type: 'serverKill', reason: 'Server shut down.' });
  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(killMsg);
      player.ws.close();
    }
  }
  process.exit();
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`AZ Tank Game server running on http://localhost:${PORT}`);
  console.log('Press S to force-start, R to restart, Ctrl+C to quit.');
});
