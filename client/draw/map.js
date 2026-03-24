import { state } from '../state.js';
import { canvas, ctx } from '../canvas.js';

export function drawMap() {
  ctx.fillStyle = '#C0C0C0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!state.map) return;

  ctx.strokeStyle = '#4A4A4A';
  ctx.lineWidth = Math.max(4, state.cellSize * 0.08);
  ctx.lineCap = 'square';

  // Horizontal walls
  for (let row = 0; row < state.map.hWalls.length; row++) {
    for (let col = 0; col < state.map.hWalls[row].length; col++) {
      if (state.map.hWalls[row][col]) {
        ctx.beginPath();
        ctx.moveTo(col * state.cellSize, row * state.cellSize);
        ctx.lineTo((col + 1) * state.cellSize, row * state.cellSize);
        ctx.stroke();
      }
    }
  }

  // Vertical walls
  for (let row = 0; row < state.map.vWalls.length; row++) {
    for (let col = 0; col < state.map.vWalls[row].length; col++) {
      if (state.map.vWalls[row][col]) {
        ctx.beginPath();
        ctx.moveTo(col * state.cellSize, row * state.cellSize);
        ctx.lineTo(col * state.cellSize, (row + 1) * state.cellSize);
        ctx.stroke();
      }
    }
  }
}
