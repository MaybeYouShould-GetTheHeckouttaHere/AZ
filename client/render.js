import { state } from './state.js';
import { canvas, ctx } from './canvas.js';
import { getShakeOffset } from './screenshake.js';
import { updateAndDrawParticles } from './particles.js';
import { drawMap } from './draw/map.js';
import { drawTank } from './draw/tank.js';
import { drawBullet } from './draw/bullet.js';
import { drawMissile, drawWirelessMissile } from './draw/missile.js';
import { drawPowerUp } from './draw/powerup.js';
import { drawLandmine } from './draw/landmine.js';
import { drawIceTrap } from './draw/icetrap.js';
import { drawPlayerIndicator } from './draw/indicator.js';
import { drawHUD } from './draw/hud.js';
import { drawLobby } from './draw/lobby.js';
import { drawScoreOverlay } from './draw/score.js';

let lastRenderTime = performance.now();

function render() {
  requestAnimationFrame(render);
  const now = performance.now();
  const dt = (now - lastRenderTime) / 1000;
  lastRenderTime = now;

  if (state.shakeTimeLeft > 0) state.shakeTimeLeft -= dt;

  if (state.gamePhase === 'connect') {
    // HTML connect screen visible
  } else if (state.gamePhase === 'lobby') {
    drawLobby();
  } else if (state.gamePhase === 'playing') {
    const shake = getShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);
    drawMap();
    state.gamePowerUps.forEach(pu => drawPowerUp(pu));
    state.gameLandmines.forEach(lm => drawLandmine(lm));
    state.gameIceTraps.forEach(it => drawIceTrap(it));
    updateAndDrawParticles(dt);
    const me = state.players.find(p => p.id === state.myId);
    drawPlayerIndicator(me);
    state.players.forEach(p => { if (p.alive) drawTank(p); });
    state.bullets.forEach(b => drawBullet(b));
    state.gameMissiles.forEach(m => drawMissile(m));
    state.gameWirelessMissiles.forEach(wm => drawWirelessMissile(wm));
    ctx.restore();
    drawHUD();
  } else if (state.gamePhase === 'roundEnd') {
    drawMap();
    state.gamePowerUps.forEach(pu => drawPowerUp(pu));
    state.gameLandmines.forEach(lm => drawLandmine(lm));
    state.gameIceTraps.forEach(it => drawIceTrap(it));
    updateAndDrawParticles(dt);
    state.players.forEach(p => drawTank(p));
    state.bullets.forEach(b => drawBullet(b));
    state.gameMissiles.forEach(m => drawMissile(m));
    state.gameWirelessMissiles.forEach(wm => drawWirelessMissile(wm));
    drawHUD();
    drawScoreOverlay();
  }
}

export function startRender() { render(); }
