import { state } from '../state.js';
import { canvas, ctx } from '../canvas.js';
import { getPlayerName, drawRoundedRect } from '../utils.js';

export function drawScoreOverlay() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  let y = canvas.height * 0.3;

  // Winner text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${canvas.width * 0.07}px sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  if (state.winnerId != null) {
    ctx.fillText(`${getPlayerName(state.winnerId)} wins!`, cx, y);
  } else {
    ctx.fillText('Tie!', cx, y);
  }
  ctx.shadowBlur = 0;

  // Countdown
  y += canvas.width * 0.08;
  const remaining = Math.max(0, Math.ceil((state.countdownEnd - Date.now()) / 1000));
  ctx.font = `${canvas.width * 0.035}px sans-serif`;
  ctx.fillStyle = '#cccccc';
  ctx.fillText(`Next round in ${remaining}...`, cx, y);

  // Scores
  y += canvas.width * 0.07;
  ctx.font = `bold ${canvas.width * 0.03}px sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Scores', cx, y);

  y += canvas.width * 0.045;
  ctx.font = `${canvas.width * 0.025}px sans-serif`;
  const scoreIds = Object.keys(state.scores).sort((a, b) => Number(a) - Number(b));
  for (const id of scoreIds) {
    const color = state.colors[id] || '#888';
    ctx.fillStyle = color;
    ctx.fillText(`${getPlayerName(id)}: ${state.scores[id]}`, cx, y);
    y += canvas.width * 0.035;
  }

  // Rematch button
  const btnW = canvas.width * 0.3;
  const btnH = canvas.width * 0.06;
  const btnX = cx - btnW / 2;
  const btnY = y + canvas.width * 0.02;
  state.rematchBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

  const alreadyVoted = state.rematchVotes.includes(state.myId);

  ctx.fillStyle = alreadyVoted ? '#335533' : '#446644';
  ctx.strokeStyle = '#88bb88';
  ctx.lineWidth = 2;
  drawRoundedRect(btnX, btnY, btnW, btnH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.font = `bold ${canvas.width * 0.025}px sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(alreadyVoted ? 'Voted!' : 'Rematch', cx, btnY + btnH / 2);

  if (state.rematchVotes.length > 0) {
    const voteY = btnY + btnH + canvas.width * 0.03;
    ctx.font = `${canvas.width * 0.02}px sans-serif`;
    ctx.fillStyle = '#aaaaaa';
    const voterNames = state.rematchVotes.map(id => getPlayerName(id)).join(', ');
    ctx.fillText(`Votes: ${voterNames}`, cx, voteY);
  }
}
