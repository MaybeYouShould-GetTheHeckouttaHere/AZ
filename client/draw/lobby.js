import { state } from '../state.js';
import { canvas, ctx } from '../canvas.js';
import { drawRoundedRect } from '../utils.js';

export function drawLobby() {
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  let y = canvas.height * 0.15;

  // Title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${canvas.width * 0.12}px sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('AZ', cx, y);

  // Player count
  y += canvas.width * 0.1;
  ctx.font = `bold ${canvas.width * 0.03}px sans-serif`;
  ctx.fillStyle = '#aaaaaa';
  ctx.fillText(`Players: ${state.lobbyPlayers.length}`, cx, y);

  // Player list
  y += canvas.width * 0.05;
  ctx.font = `${canvas.width * 0.025}px sans-serif`;
  for (const p of state.lobbyPlayers) {
    // Swatch
    ctx.fillStyle = p.color;
    ctx.fillRect(cx - 100, y - 7, 14, 14);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 100, y - 7, 14, 14);
    // Name
    ctx.fillStyle = '#cccccc';
    ctx.textAlign = 'left';
    ctx.fillText(p.name, cx - 80, y);
    // Ready status
    ctx.textAlign = 'right';
    if (p.ready) {
      ctx.fillStyle = '#55cc55';
      ctx.fillText('Ready', cx + 100, y);
    } else {
      ctx.fillStyle = '#666666';
      ctx.fillText('Not Ready', cx + 100, y);
    }
    ctx.textAlign = 'center';
    y += canvas.width * 0.04;
  }

  // Ready button
  y += canvas.width * 0.02;
  const btnW = canvas.width * 0.3;
  const btnH = canvas.width * 0.06;
  const btnX = cx - btnW / 2;
  const btnY = y;
  state.readyBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

  const myLobby = state.lobbyPlayers.find(p => p.id === state.myId);
  const amReady = myLobby && myLobby.ready;

  ctx.fillStyle = amReady ? '#335533' : '#446644';
  ctx.strokeStyle = amReady ? '#55cc55' : '#88bb88';
  ctx.lineWidth = 2;
  drawRoundedRect(btnX, btnY, btnW, btnH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.font = `bold ${canvas.width * 0.025}px sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(amReady ? 'Ready!' : 'Ready Up', cx, btnY + btnH / 2);

  // Countdown
  if (state.readyCountdownEnd) {
    const remaining = Math.max(0, Math.ceil((state.readyCountdownEnd - Date.now()) / 1000));
    y = btnY + btnH + canvas.width * 0.04;
    ctx.font = `bold ${canvas.width * 0.03}px sans-serif`;
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`Starting in ${remaining}...`, cx, y);
  }

  // Connection status
  y = canvas.height * 0.9;
  ctx.font = `${canvas.width * 0.02}px sans-serif`;
  if (state.ws && state.ws.readyState === 1) {
    ctx.fillStyle = '#55cc55';
    ctx.fillText('Connected', cx, y);
  } else {
    ctx.fillStyle = '#cc5555';
    ctx.fillText('Disconnected', cx, y);
  }
}
