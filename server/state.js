'use strict';

const state = {
  gameState: 'lobby',
  players: new Map(),
  tickInterval: null,
  bullets: [],
  currentMap: null,
  scores: {},
  readyCountdownTimer: null,
  rematchVotes: new Set(),
  roundEndTimer: null,
  powerUps: [],
  missiles: [],
  wirelessMissiles: [],
  nextPowerUpId: 1,
  nextMissileId: 1,
  nextWirelessMissileId: 1,
  nextLandmineId: 1,
  nextIceTrapId: 1,
  powerUpSpawnTimer: 0,
  landmines: [],
  iceTraps: [],
  frameHits: [],
  frameDeaths: [],
  lastTickTime: 0,
};

module.exports = state;
