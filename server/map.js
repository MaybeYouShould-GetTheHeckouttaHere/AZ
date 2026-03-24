'use strict';

const { C, cfg: getCfg } = require('./config');
const { hasLineOfSight, bfsDistance } = require('./pathfinding');

// --- Color Assignment ---
function assignColor(playerIndex) {
  const PRESET_COLORS = C.PRESET_COLORS;
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
  const cfg = getCfg();
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

module.exports = { assignColor, hslToHex, generateMap, spawnPlayers, debugPrintMap };
