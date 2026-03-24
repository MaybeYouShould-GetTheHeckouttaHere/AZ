import { resizeCanvas } from './canvas.js';
import { connect } from './network.js';
import { setupInputListeners } from './input.js';
import { startRender } from './render.js';

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const connectBtn = document.getElementById('connectBtn');
const nameInput = document.getElementById('nameInput');
connectBtn.addEventListener('click', connect);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });

setupInputListeners();
startRender();
