import { state } from '../state.js';
import { ctx } from '../canvas.js';

export function drawLandmine(lm) {
  const px = lm.x * state.cellSize;
  const py = lm.y * state.cellSize;
  const r = state.cellSize * 0.15;

  ctx.save();
  ctx.globalAlpha = lm.alpha ?? 1;
  ctx.translate(px, py);

  // Outer circle
  ctx.fillStyle = lm.armed ? '#6b3030' : '#555';
  ctx.strokeStyle = lm.armed ? '#993333' : '#444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Spikes (only when armed)
  if (lm.armed) {
    ctx.strokeStyle = '#993333';
    ctx.lineWidth = 1;
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * r * 0.8, Math.sin(ang) * r * 0.8);
      ctx.lineTo(Math.cos(ang) * r * 1.3, Math.sin(ang) * r * 1.3);
      ctx.stroke();
    }
  }

  // Button
  ctx.fillStyle = lm.armed ? '#ff4444' : '#888';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
