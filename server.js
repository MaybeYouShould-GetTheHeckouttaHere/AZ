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

// --- Game State ---
let gameState = 'lobby'; // lobby | playing | roundEnd
let players = new Map();  // id -> { ws, color, input, alive, msgTimestamps }
let nextPlayerId = 1;
let tickInterval = null;

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

function tick() {
  broadcastState();
}

function broadcastState() {
  const state = { type: 'state' };
  const msg = JSON.stringify(state);
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
    msgTimestamps: [],
  });

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
  });

  ws.on('close', () => {
    players.delete(playerId);
    console.log(`Player ${playerId} disconnected. Total: ${players.size}`);

    if (gameState === 'playing' && players.size === 0) {
      stopGame();
    }
  });
});

// --- Game Flow ---
function startGame() {
  if (players.size === 0) {
    console.log('No players connected. Cannot start.');
    return;
  }
  gameState = 'playing';
  const map = generateMap(players.size);
  const spawns = spawnPlayers(map, players);
  debugPrintMap(map, spawns);
  tickInterval = setInterval(tick, 1000 / TICK_RATE);
  console.log(`Game started with ${players.size} player(s).`);
}

function stopGame() {
  gameState = 'lobby';
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  console.log('Round ended. Returning to lobby.');
}

function restartGame() {
  stopGame();
  startGame();
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
      console.log('Starting game...');
      startGame();
    }
    if (key.toLowerCase() === 'r') {
      console.log('Restarting game...');
      restartGame();
    }
  });
}

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`AZ Tank Game server running on http://localhost:${PORT}`);
  console.log('Press S to start game, R to restart, Ctrl+C to quit.');
});
