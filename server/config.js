'use strict';
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const PORT = cfg.port; // port can't change at runtime

const C = {
  TICK_RATE: cfg.tickRate,
  MSG_RATE_LIMIT: cfg.msgRateLimit,
  PRESET_COLORS: cfg.colors,
  MAX_PLAYERS: cfg.maxPlayers || 6,
  READY_THRESHOLD: cfg.readyThreshold || 0.67,
  READY_COUNTDOWN_MS: cfg.readyCountdownMs || 10000,
  TANK_RADIUS: cfg.tankRadius,
  BULLET_RADIUS: cfg.bulletRadius,
  TANK_SPEED: cfg.tankSpeed,
  ROTATION_SPEED: cfg.rotationSpeed * Math.PI / 180,
  BULLET_SPEED: cfg.bulletSpeed,
  MAX_BOUNCES: cfg.maxBounces,
  TANK_HP: cfg.tankHP,
  FIRE_COOLDOWN: cfg.fireCooldown ?? 1,
  MISSILE_SPEED: cfg.missileSpeed || 3.2,
  MISSILE_ARM_TIME: cfg.missileArmTime || 0.6,
  MISSILE_ARM_SPEED: cfg.missileArmSpeed || 5.4,
  MISSILE_MIN_TURN_RADIUS: cfg.missileMinTurnRadius || 0.8,
  MISSILE_ACCEL: cfg.missileAccel || 8,
  WIRELESS_MISSILE_SPEED: cfg.wirelessMissileSpeed || 4.5,
  WIRELESS_MISSILE_TURN_DIAMETER: cfg.wirelessMissileTurnDiameter || 0.75,
  WIRELESS_MISSILE_LIFETIME: cfg.wirelessMissileLifetime || 12,
  MISSILE_RADIUS: cfg.missileRadius || 0.15,
  MISSILE_LIFETIME: cfg.missileLifetime || 12,
  MISSILE_RETARGET_INTERVAL: cfg.missileRetargetInterval || 1,
  POWERUP_SPAWN_INTERVAL: cfg.powerUpSpawnInterval || 10,
  POWERUP_RADIUS: cfg.powerUpRadius || 0.3,
  MAX_POWERUPS: cfg.maxPowerUps || 3,
  LANDMINE_ARM_TIME: cfg.landmineArmTime || 1,
  LANDMINE_FADE_TIME: cfg.landmineFadeTime || 2,
  LANDMINE_RADIUS: cfg.landmineRadius || 0.18,
  ICE_ARM_TIME: cfg.iceArmTime || cfg.iceVisibleTime || 1,
  ICE_FADE_TIME: cfg.iceFadeTime || 2,
  ICE_EFFECT_DURATION: cfg.iceEffectDuration || 3,
  ICE_TRACTION: cfg.iceTraction || 0.05,
  ICE_TURN_TRACTION: cfg.iceTurnTraction || 1.5,
  ICE_RADIUS: cfg.iceRadius || 0.2,
  PATHFIND_INTERVAL: cfg.pathfindInterval ?? 5,
  PATHFIND_ENEMY_COUNT: cfg.pathfindEnemyCount ?? 2,
};

function reloadConfig() {
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    C.TICK_RATE = cfg.tickRate;
    C.MSG_RATE_LIMIT = cfg.msgRateLimit;
    C.PRESET_COLORS = cfg.colors;
    C.TANK_RADIUS = cfg.tankRadius;
    C.BULLET_RADIUS = cfg.bulletRadius;
    C.TANK_SPEED = cfg.tankSpeed;
    C.ROTATION_SPEED = cfg.rotationSpeed * Math.PI / 180;
    C.BULLET_SPEED = cfg.bulletSpeed;
    C.MAX_BOUNCES = cfg.maxBounces;
    C.TANK_HP = cfg.tankHP;
    C.FIRE_COOLDOWN = cfg.fireCooldown ?? 1;
    C.MAX_PLAYERS = cfg.maxPlayers || 6;
    C.READY_THRESHOLD = cfg.readyThreshold || 0.67;
    C.READY_COUNTDOWN_MS = cfg.readyCountdownMs || 10000;
    C.MISSILE_SPEED = cfg.missileSpeed || 3.2;
    C.MISSILE_ARM_TIME = cfg.missileArmTime || 0.6;
    C.MISSILE_ARM_SPEED = cfg.missileArmSpeed || 5.4;
    C.MISSILE_MIN_TURN_RADIUS = cfg.missileMinTurnRadius || 0.8;
    C.MISSILE_ACCEL = cfg.missileAccel || 8;
    C.WIRELESS_MISSILE_SPEED = cfg.wirelessMissileSpeed || 4.5;
    C.WIRELESS_MISSILE_TURN_DIAMETER = cfg.wirelessMissileTurnDiameter || 0.75;
    C.WIRELESS_MISSILE_LIFETIME = cfg.wirelessMissileLifetime || 12;
    C.MISSILE_RADIUS = cfg.missileRadius || 0.15;
    C.MISSILE_LIFETIME = cfg.missileLifetime || 12;
    C.MISSILE_RETARGET_INTERVAL = cfg.missileRetargetInterval || 1;
    C.POWERUP_SPAWN_INTERVAL = cfg.powerUpSpawnInterval || 10;
    C.POWERUP_RADIUS = cfg.powerUpRadius || 0.3;
    C.MAX_POWERUPS = cfg.maxPowerUps || 3;
    C.LANDMINE_ARM_TIME = cfg.landmineArmTime || 1;
    C.LANDMINE_FADE_TIME = cfg.landmineFadeTime || 2;
    C.LANDMINE_RADIUS = cfg.landmineRadius || 0.18;
    C.ICE_ARM_TIME = cfg.iceArmTime || cfg.iceVisibleTime || 1;
    C.ICE_FADE_TIME = cfg.iceFadeTime || 2;
    C.ICE_EFFECT_DURATION = cfg.iceEffectDuration || 3;
    C.ICE_TRACTION = cfg.iceTraction || 0.05;
    C.ICE_TURN_TRACTION = cfg.iceTurnTraction || 1.5;
    C.ICE_RADIUS = cfg.iceRadius || 0.2;
    C.PATHFIND_INTERVAL = cfg.pathfindInterval ?? 5;
    C.PATHFIND_ENEMY_COUNT = cfg.pathfindEnemyCount ?? 2;
    console.log('Config reloaded.');
  } catch (e) {
    console.error('Failed to reload config:', e.message);
  }
}

module.exports = { cfg: () => cfg, C, PORT, reloadConfig };
