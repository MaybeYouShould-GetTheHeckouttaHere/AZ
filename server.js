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

// --- Placeholder Functions ---
function generateMap(playerCount) {
  return null;
}

function spawnPlayers(map, players) {
  // does nothing
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
  spawnPlayers(map, players);
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
