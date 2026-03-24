import { state } from '../state.js';
import { canvas, ctx } from '../canvas.js';
import { getPlayerName, truncateName } from '../utils.js';

function tankInRect(rx, ry, rw, rh) {
  const margin = state.cellSize * 0.3;
  for (const p of state.players) {
    if (!p.alive) continue;
    const px = p.x * state.cellSize;
    const py = p.y * state.cellSize;
    if (px + margin >= rx && px - margin <= rx + rw &&
        py + margin >= ry && py - margin <= ry + rh) {
      return true;
    }
  }
  return false;
}

export function drawHUD() {
  const padding = 10;
  const rowH = 25;
  const fontSize = Math.max(11, Math.min(14, canvas.width * 0.018));
  ctx.font = `bold ${fontSize}px sans-serif`;

  const sorted = [...state.players].sort((a, b) => a.id - b.id);
  const FADE_ALPHA = 0.3;

  // --- Compute uniform pip offset for health display ---
  let maxNameWidth = 0;
  const displayNames = {};
  for (const p of sorted) {
    const dn = truncateName(getPlayerName(p.id), 20);
    displayNames[p.id] = dn;
    const w = ctx.measureText(dn).width;
    if (w > maxNameWidth) maxNameWidth = w;
  }
  // swatch(10) + gap(5) + maxNameWidth + gap(8) = pip start offset from padding
  const pipStartX = padding + 10 + 5 + maxNameWidth + 8;

  // --- Health display bounding box (for fade check) ---
  const healthW = pipStartX - padding + 3 * 16 + 10;
  const healthH = sorted.length * rowH + 4;
  const healthFade = tankInRect(0, 0, healthW, healthH);

  ctx.save();
  if (healthFade) ctx.globalAlpha = FADE_ALPHA;

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const y = padding + i * rowH + 12;
    const color = p.color || state.colors[p.id] || '#888';

    // Color swatch
    ctx.fillStyle = color;
    ctx.fillRect(padding, y - 8, 10, 10);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding, y - 8, 10, 10);

    // Name
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayNames[p.id], padding + 15, y - 3);

    // Health pips (uniform start position)
    const hp = p.hp != null ? p.hp : 0;
    for (let h = 0; h < 3; h++) {
      const pipX = pipStartX + h * 16;
      const pipY = y - 3;
      ctx.beginPath();
      ctx.arc(pipX, pipY, 5, 0, Math.PI * 2);
      ctx.fillStyle = h < hp ? color : '#555555';
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  // --- Score display (top-right) ---
  let maxScoreW = 0;
  const scoreEntries = [];
  for (const p of sorted) {
    const dn = displayNames[p.id];
    const wins = state.scores[p.id] || 0;
    const scoreStr = String(wins);
    const sw = ctx.measureText(scoreStr).width;
    if (sw > maxScoreW) maxScoreW = sw;
    scoreEntries.push({ p, dn, wins, scoreStr });
  }
  const scoreGap = 10;
  const nameEndX = canvas.width - padding - maxScoreW - scoreGap;

  // Score bounding box (for fade check)
  const headerRow = padding + 12;
  let maxScoreNameW = ctx.measureText('Scores').width;
  for (const e of scoreEntries) {
    const w = ctx.measureText(e.dn).width + scoreGap + ctx.measureText(e.scoreStr).width;
    if (w > maxScoreNameW) maxScoreNameW = w;
  }
  const scoreBoxW = maxScoreNameW + padding + 10;
  const scoreBoxH = (sorted.length + 1) * rowH + 4;
  const scoreFade = tankInRect(canvas.width - scoreBoxW, 0, scoreBoxW, scoreBoxH);

  ctx.save();
  if (scoreFade) ctx.globalAlpha = FADE_ALPHA;

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 2;
  ctx.fillText('Scores', canvas.width - padding, headerRow);
  ctx.shadowBlur = 0;

  for (let i = 0; i < scoreEntries.length; i++) {
    const { p, dn, wins, scoreStr } = scoreEntries[i];
    const y = padding + (i + 1) * rowH + 12;
    const color = p.color || state.colors[p.id] || '#888';

    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    ctx.textAlign = 'right';
    ctx.fillText(scoreStr, canvas.width - padding, y);
    ctx.fillText(dn, nameEndX, y);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}
