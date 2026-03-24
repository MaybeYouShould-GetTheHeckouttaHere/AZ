'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const { C, cfg: getCfg } = require('./config');
const state = require('./state');
const { startGame, startNewRound, stopGame, endRound, checkReadyState, fullRestart } = require('./game');
const { broadcastLobby } = require('./broadcast');
const { assignColor } = require('./map');
const { getColorsMap } = require('./broadcast');

// --- HTTP Server ---
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const ext = path.extname(url);
  if (req.method === 'GET' && MIME[ext]) {
    const filePath = path.join(__dirname, '..', url);
    // Only allow files within the project directory
    const projectDir = path.join(__dirname, '..');
    if (!filePath.startsWith(projectDir)) { res.writeHead(403); res.end(); return; }
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
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
    maxPlayers: C.MAX_PLAYERS,
    currentPlayers: state.players.size,
    gameState: state.gameState,
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
      if (state.players.size >= C.MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', message: 'Server is full.' }));
        ws.close();
        return;
      }

      let name = (typeof msg.name === 'string' && msg.name.trim()) ? msg.name.trim().slice(0, 16) : null;

      // Ensure unique name
      const takenNames = new Set(Array.from(state.players.values()).map(p => p.name.toLowerCase()));
      if (!name || takenNames.has(name.toLowerCase())) {
        ws.send(JSON.stringify({ type: 'error', message: 'That name is already taken.' }));
        return;
      }

      // All validation passed — commit
      playerId = 1;
      while (state.players.has(playerId)) playerId++;
      joined = true;

      // Assign lowest unused color index
      const usedColorIndices = new Set(Array.from(state.players.values()).map(p => p.colorIndex));
      let colorIndex = 0;
      while (usedColorIndices.has(colorIndex)) colorIndex++;
      const color = assignColor(colorIndex);

      const joinedMidMatch = state.gameState === 'playing';

      state.players.set(playerId, {
        ws,
        color,
        colorIndex,
        name,
        ready: false,
        input: { w: false, a: false, s: false, d: false, space: false },
        alive: !joinedMidMatch,
        hp: joinedMidMatch ? 0 : C.TANK_HP,
        x: 0,
        y: 0,
        angle: 0,
        spacePrev: false,
        fireCooldown: 0,
        powerUp: null,
        pilotingMissileId: null,
        vx: 0, vy: 0, angularVel: 0,
        iceTimer: 0,
        msgTimestamps: [],
      });

      if (state.scores[playerId] === undefined) {
        state.scores[playerId] = 0;
      }

      console.log(`${name} (P${playerId}) connected (${color}, colorIdx ${colorIndex})${joinedMidMatch ? ' [spectating]' : ''}. Total: ${state.players.size}`);

      // Send init
      ws.send(JSON.stringify({
        type: 'init',
        playerId,
        colors: getColorsMap(),
        names: Object.fromEntries(Array.from(state.players.entries()).map(([id, p]) => [id, p.name])),
      }));

      // If joining mid-match, send map
      if (joinedMidMatch && state.currentMap) {
        ws.send(JSON.stringify({ type: 'newRound', map: state.currentMap }));
      }

      // Notify all players
      broadcastLobby();
      return;
    }

    // Everything below requires a joined player
    if (!joined) return;
    const player = state.players.get(playerId);
    if (!player) return;

    // Rate limiting
    const now = Date.now();
    player.msgTimestamps.push(now);
    player.msgTimestamps = player.msgTimestamps.filter(t => now - t < 1000);
    if (player.msgTimestamps.length > C.MSG_RATE_LIMIT) {
      return;
    }

    // --- Ready toggle ---
    if (msg.type === 'ready' && state.gameState === 'lobby') {
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

    if (msg.type === 'rematch' && state.gameState === 'roundEnd') {
      state.rematchVotes.add(playerId);
      console.log(`Player ${playerId} voted for rematch. Votes: ${state.rematchVotes.size}/${state.players.size}`);

      // Broadcast rematch vote status
      const voteMsg = JSON.stringify({
        type: 'rematch',
        votes: Array.from(state.rematchVotes),
      });
      for (const [id, p] of state.players) {
        if (p.ws.readyState === 1) {
          p.ws.send(voteMsg);
        }
      }

      // Check if rematch should trigger immediately
      // Host = first connected player (lowest ID)
      const hostId = Math.min(...Array.from(state.players.keys()));
      const allNonHostVoted = Array.from(state.players.keys())
        .filter(id => id !== hostId)
        .every(id => state.rematchVotes.has(id));

      if (state.rematchVotes.has(hostId) || (state.players.size > 1 && allNonHostVoted)) {
        console.log('Rematch vote passed! Starting new round immediately.');
        if (state.roundEndTimer) {
          clearTimeout(state.roundEndTimer);
          state.roundEndTimer = null;
        }
        if (state.players.size >= 2) {
          startNewRound();
        } else {
          state.gameState = 'lobby';
          console.log('Not enough players for new round. Returning to lobby.');
        }
      }
    }
  });

  ws.on('close', () => {
    if (!joined) return; // never fully joined, nothing to clean up
    console.log(`Player ${playerId} disconnected. Total: ${state.players.size - 1}`);

    // Clean up disconnected player's score
    delete state.scores[playerId];

    if (state.gameState === 'lobby') {
      state.players.delete(playerId);
      broadcastLobby();
      checkReadyState();
    } else if (state.gameState === 'playing') {
      // Mark as dead, don't remove (bullets stay)
      const player = state.players.get(playerId);
      if (player) {
        player.alive = false;
        console.log(`Player ${playerId} died (disconnected during play).`);
      }
      state.players.delete(playerId);

      if (state.players.size === 0) {
        stopGame();
        return;
      }

      // Check if round should end (<=1 alive among remaining players)
      let aliveCount = 0;
      let lastAliveId = null;
      for (const [id, p] of state.players) {
        if (p.alive) {
          aliveCount++;
          lastAliveId = id;
        }
      }
      if (aliveCount <= 1) {
        const winnerId = aliveCount === 1 ? lastAliveId : null;
        endRound(winnerId);
      }
    } else if (state.gameState === 'roundEnd') {
      state.players.delete(playerId);
      state.rematchVotes.delete(playerId);

      if (state.players.size < 2) {
        // Not enough players — cancel countdown and return to lobby
        if (state.roundEndTimer) {
          clearTimeout(state.roundEndTimer);
          state.roundEndTimer = null;
        }
        state.gameState = 'lobby';
        if (state.players.size === 0) {
          console.log('All players disconnected. Returning to lobby.');
        } else {
          console.log('Not enough players. Returning to lobby.');
          broadcastLobby();
        }
        return;
      }

      // Re-evaluate rematch conditions
      const hostId = Math.min(...Array.from(state.players.keys()));
      const allNonHostVoted = Array.from(state.players.keys())
        .filter(id => id !== hostId)
        .every(id => state.rematchVotes.has(id));

      if (state.rematchVotes.has(hostId) || (state.players.size > 1 && allNonHostVoted)) {
        console.log('Rematch vote passed after disconnect! Starting new round immediately.');
        if (state.roundEndTimer) {
          clearTimeout(state.roundEndTimer);
          state.roundEndTimer = null;
        }
        startNewRound();
      }
    }
  });
});

module.exports = { server, wss };
