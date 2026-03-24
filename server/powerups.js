'use strict';

const { C, cfg: getCfg } = require('./config');
const state = require('./state');

function spawnPowerUp(map) {
  const cfg = getCfg();
  const { rows, cols } = map;
  const { players, powerUps } = state;

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
        id: state.nextPowerUpId++,
        x, y,
        type: types[Math.floor(Math.random() * types.length)],
        angle: Math.random() * Math.PI * 2,
      });
      return;
    }
  }
}

module.exports = { spawnPowerUp };
