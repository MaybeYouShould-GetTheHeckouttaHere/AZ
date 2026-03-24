import { state } from '../state.js';
import { ctx } from '../canvas.js';

export function drawIceTrap(it) {
  const px = it.x * state.cellSize;
  const py = it.y * state.cellSize;
  const s = state.cellSize * 0.18;

  ctx.save();
  ctx.globalAlpha = (it.alpha ?? 1) * 0.85;
  ctx.fillStyle = it.armed ? 'rgba(135, 206, 250, 0.6)' : 'rgba(200, 230, 255, 0.5)';
  ctx.strokeStyle = it.armed ? '#4a9bd9' : '#aad4f0';
  ctx.lineWidth = 1.5;
  ctx.fillRect(px - s, py - s, s * 2, s * 2);
  ctx.strokeRect(px - s, py - s, s * 2, s * 2);
  // Shine
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px - s * 0.4, py - s * 0.7);
  ctx.lineTo(px - s * 0.4, py + s * 0.3);
  ctx.stroke();
  ctx.restore();
}
