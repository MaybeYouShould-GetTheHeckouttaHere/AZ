import { state } from '../state.js';
import { ctx } from '../canvas.js';
import { darkenColor } from '../utils.js';

export function drawMissile(m) {
  const px = m.x * state.cellSize;
  const py = m.y * state.cellSize;
  const ownerColor = state.colors[m.ownerId] || '#888';
  const size = state.cellSize * 0.12;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(m.angle + Math.PI / 2);

  // Body
  ctx.fillStyle = darkenColor(ownerColor, 0.8);
  ctx.strokeStyle = darkenColor(ownerColor, 0.5);
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  // Nose (top)
  ctx.moveTo(0, -size * 1.5);
  ctx.lineTo(size * 0.5, -size * 0.3);
  ctx.lineTo(size * 0.5, size * 0.8);
  // Fin right
  ctx.lineTo(size * 0.9, size * 1.3);
  ctx.lineTo(size * 0.5, size);
  // Bottom
  ctx.lineTo(-size * 0.5, size);
  // Fin left
  ctx.lineTo(-size * 0.9, size * 1.3);
  ctx.lineTo(-size * 0.5, size * 0.8);
  ctx.lineTo(-size * 0.5, -size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Engine glow
  ctx.fillStyle = '#ff6600';
  ctx.globalAlpha = 0.6 + Math.random() * 0.4;
  ctx.beginPath();
  ctx.arc(0, size * 1.1, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

export function drawWirelessMissile(wm) {
  const px = wm.x * state.cellSize;
  const py = wm.y * state.cellSize;
  const color = wm.color || '#888';
  const size = state.cellSize * 0.12;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(wm.angle + Math.PI / 2);

  // Body — uses owner color
  ctx.fillStyle = color;
  ctx.strokeStyle = darkenColor(color, 0.5);
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(0, -size * 1.5);
  ctx.lineTo(size * 0.5, -size * 0.3);
  ctx.lineTo(size * 0.5, size * 0.8);
  ctx.lineTo(size * 0.9, size * 1.3);
  ctx.lineTo(size * 0.5, size);
  ctx.lineTo(-size * 0.5, size);
  ctx.lineTo(-size * 0.9, size * 1.3);
  ctx.lineTo(-size * 0.5, size * 0.8);
  ctx.lineTo(-size * 0.5, -size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Black tip (warhead)
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  const tipW = size * 0.5 * 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.5);
  ctx.lineTo(-tipW / 2, -size * 0.3);
  ctx.lineTo(tipW / 2, -size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Engine glow
  ctx.fillStyle = '#ff6600';
  ctx.globalAlpha = 0.6 + Math.random() * 0.4;
  ctx.beginPath();
  ctx.arc(0, size * 1.1, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}
