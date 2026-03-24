import { state } from './state.js';
import { canvas } from './canvas.js';

export const keys = { w: false, a: false, s: false, d: false, space: false };

const keyMap = {
  'KeyW': 'w', 'KeyA': 'a', 'KeyS': 's', 'KeyD': 'd', 'Space': 'space',
  'ArrowUp': 'w', 'ArrowLeft': 'a', 'ArrowDown': 's', 'ArrowRight': 'd'
};

export function sendInput() {
  const json = JSON.stringify(keys);
  if (json !== state.lastSentKeys && state.ws && state.ws.readyState === 1) {
    state.lastSentKeys = json;
    state.ws.send(JSON.stringify({ type: 'input', keys }));
  }
}

export function setupInputListeners() {
  window.addEventListener('keydown', (e) => {
    if (state.gamePhase === 'connect') return;
    if (state.gamePhase === 'lobby' && e.code === 'Space') {
      e.preventDefault();
      if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'ready' }));
      return;
    }
    const key = keyMap[e.code];
    if (key) {
      e.preventDefault();
      keys[key] = true;
      sendInput();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (state.gamePhase === 'connect') return;
    const key = keyMap[e.code];
    if (key) {
      e.preventDefault();
      keys[key] = false;
      sendInput();
    }
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (state.gamePhase === 'lobby') {
      if (x >= state.readyBtn.x && x <= state.readyBtn.x + state.readyBtn.w &&
          y >= state.readyBtn.y && y <= state.readyBtn.y + state.readyBtn.h) {
        if (state.ws && state.ws.readyState === 1) {
          state.ws.send(JSON.stringify({ type: 'ready' }));
        }
      }
    } else if (state.gamePhase === 'roundEnd') {
      if (x >= state.rematchBtn.x && x <= state.rematchBtn.x + state.rematchBtn.w &&
          y >= state.rematchBtn.y && y <= state.rematchBtn.y + state.rematchBtn.h) {
        if (state.ws && state.ws.readyState === 1) {
          state.ws.send(JSON.stringify({ type: 'rematch' }));
        }
      }
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (state.gamePhase !== 'playing' || e.button !== 0) return;
    keys.space = true;
    sendInput();
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    keys.space = false;
    sendInput();
  });
}
