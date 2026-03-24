import { state } from '../state.js';
import { ctx } from '../canvas.js';

export function drawPowerUp(pu) {
  const px = pu.x * state.cellSize;
  const py = pu.y * state.cellSize;
  const size = state.cellSize * 0.3;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(pu.angle);

  // White outlined block
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 2;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeRect(-size / 2, -size / 2, size, size);

  // Icon per type
  const s = size * 0.35;
  ctx.lineWidth = 1;

  if (pu.type === 'missile') {
    ctx.fillStyle = '#e74c3c';
    ctx.strokeStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.35, -s * 0.3);
    ctx.lineTo(s * 0.35, s * 0.5);
    ctx.lineTo(s * 0.6, s * 0.8);
    ctx.lineTo(s * 0.35, s * 0.6);
    ctx.lineTo(-s * 0.35, s * 0.6);
    ctx.lineTo(-s * 0.6, s * 0.8);
    ctx.lineTo(-s * 0.35, s * 0.5);
    ctx.lineTo(-s * 0.35, -s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (pu.type === 'landmine') {
    // Circle with spikes
    ctx.fillStyle = '#555';
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Spikes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    for (let a = 0; a < 6; a++) {
      const ang = a * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * s * 0.5, Math.sin(ang) * s * 0.5);
      ctx.lineTo(Math.cos(ang) * s * 0.85, Math.sin(ang) * s * 0.85);
      ctx.stroke();
    }
    // Red button
    ctx.fillStyle = '#cc3333';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
    ctx.fill();
  } else if (pu.type === 'ice') {
    // Ice cube
    const cs = s * 0.7;
    ctx.fillStyle = 'rgba(135, 206, 250, 0.8)';
    ctx.strokeStyle = '#4a9bd9';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-cs, -cs, cs * 2, cs * 2);
    ctx.strokeRect(-cs, -cs, cs * 2, cs * 2);
    // Shine line
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-cs * 0.5, -cs * 0.7);
    ctx.lineTo(-cs * 0.5, cs * 0.3);
    ctx.stroke();
  } else if (pu.type === 'wirelessMissile') {
    // WiFi icon: dot + 3 arcs fanning upward
    ctx.fillStyle = '#2255cc';
    ctx.strokeStyle = '#2255cc';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    const dotY = s * 0.65;
    // Dot
    ctx.beginPath();
    ctx.arc(0, dotY, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
    // Three arcs, each centered at dot, sweeping 135° upward
    const arcStart = Math.PI * 1.175;
    const arcEnd   = Math.PI * 1.825;
    for (let ai = 0; ai < 3; ai++) {
      const r = s * (0.22 + ai * 0.42);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, dotY, r, arcStart, arcEnd);
      ctx.stroke();
    }
  }

  ctx.restore();
}
