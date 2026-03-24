'use strict';

const state = require('./state');
const { startGame, fullRestart } = require('./game');

function gracefulShutdown() {
  console.log('Shutting down...');
  const killMsg = JSON.stringify({ type: 'serverKill', reason: 'Server shut down.' });
  for (const [id, player] of state.players) {
    if (player.ws.readyState === 1) {
      player.ws.send(killMsg);
      player.ws.close();
    }
  }
  process.exit();
}

function setupKeypressListener() {
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
        if (state.gameState === 'lobby' || state.gameState === 'roundEnd') {
          console.log('Starting game...');
          startGame();
        } else {
          console.log(`Cannot start game in '${state.gameState}' state.`);
        }
      }
      if (key.toLowerCase() === 'r') {
        console.log('Full restart...');
        fullRestart();
      }
    });
  }
}

module.exports = { gracefulShutdown, setupKeypressListener };
