'use strict';

const { C } = require('./config');
const state = require('./state');

function getColorsMap() {
  const { players } = state;
  const colors = {};
  for (const [id, player] of players) {
    colors[id] = player.color;
  }
  return colors;
}

function getLobbyState() {
  const { players } = state;
  const lobbyPlayers = [];
  for (const [id, player] of players) {
    lobbyPlayers.push({ id, name: player.name, color: player.color, ready: player.ready });
  }
  return lobbyPlayers;
}

function broadcastLobby() {
  const { players } = state;
  const msg = JSON.stringify({
    type: 'lobby',
    players: getLobbyState(),
    maxPlayers: C.MAX_PLAYERS,
  });
  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }
}

function broadcastState() {
  const { players, bullets, frameHits, frameDeaths, powerUps, missiles, wirelessMissiles, landmines, iceTraps } = state;

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
      paths: wm.paths || [],
    }));
  }
  const visibleLandmines = landmines.filter(lm => lm.armTimer > 0 || lm.fadeTimer > 0);
  if (visibleLandmines.length > 0) {
    stateObj.landmines = visibleLandmines.map(lm => ({
      id: lm.id, x: lm.x, y: lm.y,
      armed: lm.armTimer <= 0,
      alpha: lm.armTimer > 0 ? 1 : Math.max(0, lm.fadeTimer / C.LANDMINE_FADE_TIME),
    }));
  }
  const visibleIceTraps = iceTraps.filter(it => it.armTimer > 0 || it.fadeTimer > 0);
  if (visibleIceTraps.length > 0) {
    stateObj.iceTraps = visibleIceTraps.map(it => ({
      id: it.id, x: it.x, y: it.y,
      armed: it.armTimer <= 0,
      alpha: it.armTimer > 0 ? 1 : Math.max(0, it.fadeTimer / C.ICE_FADE_TIME),
    }));
  }
  const msg = JSON.stringify(stateObj);

  for (const [id, player] of players) {
    if (player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  }
}

module.exports = { broadcastState, broadcastLobby, getColorsMap, getLobbyState };
