import { state } from './state.js';
import { canvas, resizeCanvas } from './canvas.js';
import { spawnMissileSmoke, spawnParticles, spawnDeathExplosion } from './particles.js';
import { startScreenShake } from './screenshake.js';

export function returnToConnectScreen(message) {
  state.gamePhase = 'connect';
  state.myId = null;
  state.colors = {};
  state.names = {};
  state.lobbyPlayers = [];
  state.players = [];
  state.bullets = [];
  state.gamePowerUps = [];
  state.gameMissiles = [];
  state.gameWirelessMissiles = [];
  state.gameLandmines = [];
  state.gameIceTraps = [];
  state.map = null;
  state.scores = {};
  state.rematchVotes = [];
  state.readyCountdownEnd = null;
  state.ws = null;

  const connectScreen = document.getElementById('connectScreen');
  const connectStatus = document.getElementById('connectStatus');
  const connectError = document.getElementById('connectError');
  const connectBtn = document.getElementById('connectBtn');
  const nameInput = document.getElementById('nameInput');

  canvas.style.display = 'none';
  connectScreen.style.display = '';
  connectStatus.textContent = '';
  connectError.textContent = message || '';
  connectBtn.disabled = false;
  nameInput.value = state.myName;
}

export function connect() {
  const nameInput = document.getElementById('nameInput');
  const connectError = document.getElementById('connectError');
  const connectStatus = document.getElementById('connectStatus');
  const connectScreen = document.getElementById('connectScreen');
  const connectBtn = document.getElementById('connectBtn');

  const name = nameInput.value.trim() || 'Player';
  state.myName = name;
  connectError.textContent = '';
  connectBtn.disabled = true;

  // If already connected (e.g. retrying after name taken), just re-send join
  if (state.ws && state.ws.readyState === 1) {
    connectStatus.textContent = 'Joining...';
    state.ws.send(JSON.stringify({ type: 'join', name }));
    return;
  }

  connectStatus.textContent = 'Connecting...';
  const host = window.location.host || 'localhost:55928';
  state.ws = new WebSocket(`ws://${host}`);

  // 7-second connection timeout
  const connectTimeout = setTimeout(() => {
    if (state.ws.readyState !== 1) {
      state.ws.close();
      connectStatus.textContent = '';
      connectError.textContent = 'Connection timed out.';
      connectBtn.disabled = false;
    }
  }, 7000);

  state.ws.addEventListener('open', () => {
    clearTimeout(connectTimeout);
    connectStatus.textContent = 'Connected, joining...';
    state.ws.send(JSON.stringify({ type: 'join', name }));
  });

  state.ws.addEventListener('close', () => {
    clearTimeout(connectTimeout);
    if (state.gamePhase !== 'connect') {
      returnToConnectScreen('Connection lost.');
    } else {
      connectStatus.textContent = '';
      connectError.textContent = 'Connection lost.';
      connectBtn.disabled = false;
    }
  });

  state.ws.addEventListener('error', () => {
    clearTimeout(connectTimeout);
    connectStatus.textContent = '';
    connectError.textContent = 'Could not connect to server.';
    connectBtn.disabled = false;
  });

  state.ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'welcome':
        // Server info before join
        break;

      case 'error':
        connectError.textContent = msg.message;
        connectStatus.textContent = '';
        connectBtn.disabled = false;
        break;

      case 'init':
        state.myId = msg.playerId;
        state.colors = msg.colors;
        state.names = msg.names || {};
        connectScreen.style.display = 'none';
        canvas.style.display = 'block';
        state.gamePhase = 'lobby';
        resizeCanvas();
        break;

      case 'lobby':
        state.lobbyPlayers = msg.players;
        // Rebuild colors/names from lobby data (clears stale entries)
        state.colors = {};
        state.names = {};
        for (const p of msg.players) {
          state.colors[p.id] = p.color;
          state.names[p.id] = p.name;
        }
        if (state.gamePhase === 'roundEnd' || state.gamePhase === 'playing') {
          state.scores = {};
        }
        if (state.gamePhase !== 'playing') {
          state.gamePhase = 'lobby';
        }
        break;

      case 'readyCountdown':
        state.readyCountdownEnd = msg.endsAt;
        break;

      case 'newRound':
        state.gamePhase = 'playing';
        state.map = msg.map;
        state.cellSize = canvas.width / msg.map.rows;
        state.readyCountdownEnd = null;
        if (msg.spawns) {
          state.players = msg.spawns.map(s => ({
            id: s.id, name: s.name || state.names[s.id], x: s.x, y: s.y, angle: s.angle,
            hp: 3, alive: true, color: s.color
          }));
          state.bullets = [];
          state.gamePowerUps = [];
          state.gameMissiles = [];
          state.gameWirelessMissiles = [];
          state.gameLandmines = [];
          state.gameIceTraps = [];
          state.particles = [];
        }
        break;

      case 'state':
        state.players = msg.players;
        for (const p of msg.players) {
          if (p.name) state.names[p.id] = p.name;
        }
        state.bullets = msg.bullets;
        state.gamePowerUps = msg.powerUps || [];
        state.gameLandmines = msg.landmines || [];
        state.gameIceTraps = msg.iceTraps || [];
        if (msg.missiles) {
          for (const m of msg.missiles) {
            const targetColor = m.targetId != null ? (state.colors[m.targetId] || '#888') : '#888';
            spawnMissileSmoke(m.x, m.y, m.angle, targetColor);
          }
        }
        state.gameMissiles = msg.missiles || [];
        if (msg.wirelessMissiles) {
          for (const wm of msg.wirelessMissiles) {
            spawnMissileSmoke(wm.x, wm.y, wm.angle, wm.color);
          }
        }
        state.gameWirelessMissiles = msg.wirelessMissiles || [];
        if (msg.hits) {
          for (const hit of msg.hits) {
            spawnParticles(hit.x, hit.y);
          }
        }
        if (msg.deaths) {
          for (const d of msg.deaths) {
            spawnDeathExplosion(d.x, d.y, d.color);
            startScreenShake(0.25, 4);
          }
        }
        break;

      case 'roundEnd':
        state.gamePhase = 'roundEnd';
        state.winnerId = msg.winnerId;
        state.scores = msg.scores;
        state.countdownEnd = Date.now() + 5000;
        state.rematchVotes = [];
        break;

      case 'rematch':
        state.rematchVotes = msg.votes;
        break;

      case 'serverKill':
        returnToConnectScreen(msg.reason || 'Server disconnected.');
        break;
    }
  });
}
