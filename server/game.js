'use strict';

const { C, cfg: getCfg } = require('./config');
const state = require('./state');
const { generateMap, spawnPlayers, debugPrintMap } = require('./map');
const { broadcastState, broadcastLobby } = require('./broadcast');
const { createTick } = require('./tick');

// endRound is defined here, tick needs it — createTick receives it as argument
function endRound(winnerId) {
  // Stop the tick loop
  if (state.tickInterval) {
    clearInterval(state.tickInterval);
    state.tickInterval = null;
  }

  state.gameState = 'roundEnd';

  // Increment winner's score
  if (winnerId !== null) {
    if (state.scores[winnerId] === undefined) state.scores[winnerId] = 0;
    state.scores[winnerId]++;
    console.log(`Round ended - Player ${winnerId} wins!`);
  } else {
    console.log('Round ended - Tie!');
  }

  // Reset rematch votes
  state.rematchVotes = new Set();

  // Broadcast roundEnd
  const msg = JSON.stringify({
    type: 'roundEnd',
    winnerId,
    scores: state.scores,
  });
  for (const [id, player] of state.players) {
    if (player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }

  // Set auto-restart timer
  console.log('Waiting for new round...');
  state.roundEndTimer = setTimeout(() => {
    state.roundEndTimer = null;
    if (state.players.size >= 2) {
      startNewRound();
    } else {
      state.gameState = 'lobby';
      console.log('Not enough players for new round. Returning to lobby.');
      broadcastLobby();
    }
  }, getCfg().roundEndDelay);
}

// Create the tick function bound to endRound
const tick = createTick(endRound);

function startNewRound() {
  state.gameState = 'playing';
  state.bullets = [];
  state.powerUps = [];
  state.missiles = [];
  state.wirelessMissiles = [];
  state.landmines = [];
  state.iceTraps = [];
  state.powerUpSpawnTimer = C.POWERUP_SPAWN_INTERVAL;
  state.currentMap = generateMap(state.players.size);
  const spawns = spawnPlayers(state.currentMap, state.players);
  debugPrintMap(state.currentMap, spawns);

  // Initialize player game state
  for (const [id, player] of state.players) {
    player.hp = C.TANK_HP;
    player.alive = true;
    player.spacePrev = false;
    player.powerUp = null;
    player.pilotingMissileId = null;
    player.vx = 0; player.vy = 0; player.angularVel = 0;
    player.iceTimer = 0;
  }

  // Build spawns array for broadcast
  const spawnsArr = [];
  for (const [id, player] of state.players) {
    spawnsArr.push({ id, name: player.name, x: player.x, y: player.y, angle: player.angle, color: player.color });
  }

  // Broadcast newRound
  const msg = JSON.stringify({
    type: 'newRound',
    map: { rows: state.currentMap.rows, cols: state.currentMap.cols, hWalls: state.currentMap.hWalls, vWalls: state.currentMap.vWalls },
    spawns: spawnsArr,
  });
  for (const [id, player] of state.players) {
    if (player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }

  state.lastTickTime = 0;
  state.tickInterval = setInterval(tick, 1000 / C.TICK_RATE);
  console.log(`New round started with ${state.players.size} player(s).`);
}

function checkReadyState() {
  if (state.gameState !== 'lobby') return;
  if (state.players.size < 2) {
    // Cancel any pending countdown
    if (state.readyCountdownTimer) {
      clearTimeout(state.readyCountdownTimer);
      state.readyCountdownTimer = null;
      broadcastLobby();
    }
    return;
  }

  const readyCount = Array.from(state.players.values()).filter(p => p.ready).length;
  const total = state.players.size;

  // All ready → start instantly
  if (readyCount === total) {
    if (state.readyCountdownTimer) {
      clearTimeout(state.readyCountdownTimer);
      state.readyCountdownTimer = null;
    }
    console.log('All players ready. Starting immediately.');
    startGame();
    return;
  }

  // Threshold met → start countdown (if not already running)
  if (readyCount / total >= C.READY_THRESHOLD) {
    if (!state.readyCountdownTimer) {
      console.log(`${readyCount}/${total} ready (>= ${(C.READY_THRESHOLD * 100).toFixed(0)}%). Starting countdown.`);
      const countdownStart = Date.now();
      // Broadcast countdown start
      const msg = JSON.stringify({ type: 'readyCountdown', endsAt: countdownStart + C.READY_COUNTDOWN_MS });
      for (const [id, p] of state.players) {
        if (p.ws.readyState === 1) p.ws.send(msg);
      }
      state.readyCountdownTimer = setTimeout(() => {
        state.readyCountdownTimer = null;
        if (state.gameState === 'lobby' && state.players.size >= 2) {
          console.log('Ready countdown finished. Starting game.');
          startGame();
        }
      }, C.READY_COUNTDOWN_MS);
    }
  } else {
    // Below threshold → cancel countdown
    if (state.readyCountdownTimer) {
      clearTimeout(state.readyCountdownTimer);
      state.readyCountdownTimer = null;
      console.log('Ready count dropped below threshold. Countdown cancelled.');
      const msg = JSON.stringify({ type: 'readyCountdown', endsAt: null });
      for (const [id, p] of state.players) {
        if (p.ws.readyState === 1) p.ws.send(msg);
      }
    }
  }
}

function startGame() {
  if (state.players.size < 2) {
    console.log('Need at least 2 players to start. Cannot start.');
    return;
  }

  // Cancel any pending timers
  if (state.roundEndTimer) {
    clearTimeout(state.roundEndTimer);
    state.roundEndTimer = null;
  }
  if (state.readyCountdownTimer) {
    clearTimeout(state.readyCountdownTimer);
    state.readyCountdownTimer = null;
  }

  // Reset ready states
  for (const [id, player] of state.players) {
    player.ready = false;
  }

  state.gameState = 'playing';
  state.bullets = [];
  state.powerUps = [];
  state.missiles = [];
  state.wirelessMissiles = [];
  state.landmines = [];
  state.iceTraps = [];
  state.powerUpSpawnTimer = C.POWERUP_SPAWN_INTERVAL;
  state.currentMap = generateMap(state.players.size);
  const spawns = spawnPlayers(state.currentMap, state.players);
  debugPrintMap(state.currentMap, spawns);

  // Initialize player game state
  for (const [id, player] of state.players) {
    player.hp = C.TANK_HP;
    player.alive = true;
    player.spacePrev = false;
    player.powerUp = null;
    player.pilotingMissileId = null;
    player.vx = 0; player.vy = 0; player.angularVel = 0;
    player.iceTimer = 0;
  }

  // Build spawns array for broadcast
  const spawnsArr = [];
  for (const [id, player] of state.players) {
    spawnsArr.push({ id, name: player.name, x: player.x, y: player.y, angle: player.angle, color: player.color });
  }

  // Send newRound to all clients
  const roundMsg = JSON.stringify({
    type: 'newRound',
    map: { rows: state.currentMap.rows, cols: state.currentMap.cols, hWalls: state.currentMap.hWalls, vWalls: state.currentMap.vWalls },
    spawns: spawnsArr,
  });
  for (const [id, player] of state.players) {
    if (player.ws.readyState === 1) {
      player.ws.send(roundMsg);
    }
  }

  state.lastTickTime = 0;
  state.tickInterval = setInterval(tick, 1000 / C.TICK_RATE);
  console.log(`Game started with ${state.players.size} player(s).`);
}

function stopGame() {
  state.gameState = 'lobby';
  if (state.tickInterval) {
    clearInterval(state.tickInterval);
    state.tickInterval = null;
  }
  if (state.roundEndTimer) {
    clearTimeout(state.roundEndTimer);
    state.roundEndTimer = null;
  }
  state.bullets = [];
  state.powerUps = [];
  state.missiles = [];
  state.wirelessMissiles = [];
  state.landmines = [];
  state.iceTraps = [];
  state.currentMap = null;
  state.rematchVotes = new Set();
  for (const [id, player] of state.players) {
    player.ready = false;
  }
  console.log('Round ended. Returning to lobby.');
  broadcastLobby();
}

function fullRestart() {
  const { reloadConfig } = require('./config');
  // Reload config from disk
  reloadConfig();

  // Full restart: clear all state, disconnect all clients, return to lobby
  if (state.tickInterval) {
    clearInterval(state.tickInterval);
    state.tickInterval = null;
  }
  if (state.roundEndTimer) {
    clearTimeout(state.roundEndTimer);
    state.roundEndTimer = null;
  }
  if (state.readyCountdownTimer) {
    clearTimeout(state.readyCountdownTimer);
    state.readyCountdownTimer = null;
  }
  state.gameState = 'lobby';
  state.bullets = [];
  state.powerUps = [];
  state.missiles = [];
  state.wirelessMissiles = [];
  state.landmines = [];
  state.iceTraps = [];
  state.currentMap = null;
  state.scores = {};
  state.rematchVotes = new Set();

  // Notify and disconnect all WebSocket clients
  const killMsg = JSON.stringify({ type: 'serverKill', reason: 'Server restarted.' });
  for (const [id, player] of state.players) {
    if (player.ws.readyState === 1) {
      player.ws.send(killMsg);
      player.ws.close();
    }
  }
  state.players = new Map();
  console.log('Server restarted.');
}

module.exports = { startNewRound, endRound, checkReadyState, startGame, stopGame, fullRestart };
