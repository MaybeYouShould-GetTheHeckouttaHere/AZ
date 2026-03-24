import { state } from '../state.js';
import { canvas, ctx } from '../canvas.js';

export function drawPlayerIndicator(me) {
  if (!me || !me.alive) return;
  const color = me.color || state.colors[me.id] || '#888';
  const px = me.x * state.cellSize;
  const py = me.y * state.cellSize;
  // Scale relative to canvas so it stays visible on huge maps
  const minSize = Math.max(canvas.width * 0.025, state.cellSize * 0.5);
  const arrowH = minSize;
  const arrowW = minSize * 1.2;
  const gap = state.cellSize * 0.4 + arrowH * 0.3;
  const tipY = py - gap;
  const baseY = tipY - arrowH;

  // Check if arrow overlaps any object or HUD element
  const arrowRect = { x: px - arrowW, y: baseY - 2, w: arrowW * 2, h: arrowH + 4 };
  let obscured = false;

  // Check other players
  for (const p of state.players) {
    if (p.id === me.id || !p.alive) continue;
    const ox = p.x * state.cellSize;
    const oy = p.y * state.cellSize;
    const margin = state.cellSize * 0.25;
    if (ox + margin >= arrowRect.x && ox - margin <= arrowRect.x + arrowRect.w &&
        oy + margin >= arrowRect.y && oy - margin <= arrowRect.y + arrowRect.h) {
      obscured = true; break;
    }
  }
  // Check power-ups
  if (!obscured) {
    for (const pu of state.gamePowerUps) {
      const ox = pu.x * state.cellSize;
      const oy = pu.y * state.cellSize;
      const margin = state.cellSize * 0.3;
      if (ox + margin >= arrowRect.x && ox - margin <= arrowRect.x + arrowRect.w &&
          oy + margin >= arrowRect.y && oy - margin <= arrowRect.y + arrowRect.h) {
        obscured = true; break;
      }
    }
  }
  // Check missiles
  if (!obscured) {
    for (const m of state.gameMissiles) {
      const ox = m.x * state.cellSize;
      const oy = m.y * state.cellSize;
      const margin = state.cellSize * 0.15;
      if (ox + margin >= arrowRect.x && ox - margin <= arrowRect.x + arrowRect.w &&
          oy + margin >= arrowRect.y && oy - margin <= arrowRect.y + arrowRect.h) {
        obscured = true; break;
      }
    }
  }
  // Check HUD regions (health top-left, score top-right)
  if (!obscured) {
    const rowH = 25;
    const hudH = state.players.length * rowH + 4;
    const hudW = canvas.width * 0.35;
    if (px < hudW && tipY < hudH) obscured = true;
    if (px > canvas.width - hudW && tipY < hudH) obscured = true;
  }

  ctx.save();
  ctx.globalAlpha = obscured ? 0.2 : 0.7;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(px, tipY);
  ctx.lineTo(px - arrowW / 2, baseY);
  ctx.lineTo(px + arrowW / 2, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
