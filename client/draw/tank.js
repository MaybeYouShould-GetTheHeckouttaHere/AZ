import { state } from '../state.js';
import { ctx } from '../canvas.js';
import { darkenColor, getPlayerName } from '../utils.js';

export function drawTank(player) {
  const px = player.x * state.cellSize;
  const py = player.y * state.cellSize;
  const bodyW = 0.32 * state.cellSize;
  const bodyL = 0.42 * state.cellSize;
  const color = player.color || state.colors[player.id] || '#888888';

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(player.angle + Math.PI / 2);

  if (!player.alive) {
    ctx.globalAlpha = 0.35;
  }

  // Body
  ctx.fillStyle = color;
  ctx.fillRect(-bodyW / 2, -bodyL / 2, bodyW, bodyL);

  // Outline
  ctx.strokeStyle = darkenColor(color, 0.5);
  ctx.lineWidth = 2;
  ctx.strokeRect(-bodyW / 2, -bodyL / 2, bodyW, bodyL);

  // Barrel (turret)
  const barrelW = 0.1 * state.cellSize;
  const barrelL = 0.3 * state.cellSize;
  ctx.fillStyle = darkenColor(color, 0.7);
  ctx.strokeStyle = darkenColor(color, 0.5);
  ctx.lineWidth = 1;

  if (player.powerUp === 'missile' || player.powerUp === 'wirelessMissile') {
    // Missile / wireless missile barrel: rectangular body + triangle warhead tip
    ctx.fillRect(-barrelW / 2, -barrelL * 0.65, barrelW, barrelL * 0.65);
    ctx.strokeRect(-barrelW / 2, -barrelL * 0.65, barrelW, barrelL * 0.65);
    const tipW = barrelW * 1.6;
    const tipColor = player.powerUp === 'wirelessMissile' ? '#111' : '#e74c3c';
    const tipStroke = player.powerUp === 'wirelessMissile' ? '#000' : '#c0392b';
    ctx.fillStyle = tipColor;
    ctx.beginPath();
    ctx.moveTo(0, -barrelL - barrelW * 0.3);
    ctx.lineTo(-tipW / 2, -barrelL * 0.65);
    ctx.lineTo(tipW / 2, -barrelL * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = tipStroke;
    ctx.stroke();
  } else if (player.powerUp === 'landmine') {
    // Landmine barrel: short barrel + circle with button on top
    ctx.fillRect(-barrelW / 2, -barrelL * 0.4, barrelW, barrelL * 0.4);
    ctx.strokeRect(-barrelW / 2, -barrelL * 0.4, barrelW, barrelL * 0.4);
    const mineR = barrelW * 0.9;
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(0, -barrelL * 0.4 - mineR, mineR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.stroke();
    // Button on top
    ctx.fillStyle = '#cc3333';
    ctx.beginPath();
    ctx.arc(0, -barrelL * 0.4 - mineR - mineR * 0.3, mineR * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (player.powerUp === 'ice') {
    // Ice barrel: short barrel + ice crystal
    ctx.fillRect(-barrelW / 2, -barrelL * 0.4, barrelW, barrelL * 0.4);
    ctx.strokeRect(-barrelW / 2, -barrelL * 0.4, barrelW, barrelL * 0.4);
    const iceS = barrelW * 0.8;
    const iceY = -barrelL * 0.4 - iceS * 1.2;
    ctx.fillStyle = 'rgba(135, 206, 250, 0.8)';
    ctx.strokeStyle = '#4a9bd9';
    ctx.fillRect(-iceS, iceY - iceS, iceS * 2, iceS * 2);
    ctx.strokeRect(-iceS, iceY - iceS, iceS * 2, iceS * 2);
  } else {
    // Normal barrel
    ctx.fillRect(-barrelW / 2, -barrelL, barrelW, barrelL);
    ctx.strokeRect(-barrelW / 2, -barrelL, barrelW, barrelL);
  }

  ctx.globalAlpha = 1;
  ctx.restore();

  // Player label (not rotated) — show name
  const label = getPlayerName(player.id);
  ctx.save();
  ctx.font = `bold ${Math.max(10, state.cellSize * 0.22)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(label, px + 1, py - bodyL / 2 - 3 + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, px, py - bodyL / 2 - 3);
  ctx.restore();
}
