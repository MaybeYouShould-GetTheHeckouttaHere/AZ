import { state } from './state.js';

export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

export function resizeCanvas() {
  const size = Math.min(800, window.innerWidth - 20, window.innerHeight - 20);
  canvas.width = size;
  canvas.height = size;
  if (state.map) state.cellSize = size / state.map.rows;
}
