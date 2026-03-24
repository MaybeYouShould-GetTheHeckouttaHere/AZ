import { state } from '../state.js';
import { ctx } from '../canvas.js';

const BULLET_COLOR = '#4A4A4A';
const BULLET_GLOW = '#6A6A6A';

export function drawBullet(bullet) {
  const bx = bullet.x * state.cellSize;
  const by = bullet.y * state.cellSize;
  const r = 0.075 * state.cellSize;

  ctx.beginPath();
  ctx.arc(bx, by, r * 1.8, 0, Math.PI * 2);
  ctx.fillStyle = BULLET_GLOW;
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fillStyle = BULLET_COLOR;
  ctx.fill();
}
