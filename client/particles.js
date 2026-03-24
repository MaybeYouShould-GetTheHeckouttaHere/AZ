import { state } from './state.js';
import { ctx } from './canvas.js';

export function spawnParticles(x, y) {
  const count = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.3 + Math.random() * 0.8;
    state.particles.push({
      x, y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      life: 0.3 + Math.random() * 0.3,
      maxLife: 0.3 + Math.random() * 0.3,
      size: 0.03 + Math.random() * 0.04,
    });
  }
}

export function updateAndDrawParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.dx * dt;
    p.y += p.dy * dt;
    p.life -= dt;
    p.dx *= 0.96;
    p.dy *= 0.96;

    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }

    const maxA = p.maxAlpha || 0.4;
    const alpha = (p.life / p.maxLife) * maxA;
    const px = p.x * state.cellSize;
    const py = p.y * state.cellSize;
    const r = p.size * state.cellSize;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color || '#4A4A4A';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function spawnDeathExplosion(x, y, color) {
  const count = 14 + Math.floor(Math.random() * 6);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 1.8;
    const life = 0.5 + Math.random() * 0.5;
    state.particles.push({
      x, y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: 0.04 + Math.random() * 0.06,
      color,
      maxAlpha: 0.5,
    });
  }
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.3 + Math.random() * 0.6;
    const life = 0.6 + Math.random() * 0.4;
    state.particles.push({
      x, y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: 0.05 + Math.random() * 0.05,
      color: '#4A4A4A',
      maxAlpha: 0.35,
    });
  }
}

export function spawnMissileSmoke(x, y, angle, color) {
  for (let i = 0; i < 2; i++) {
    const backAngle = angle + Math.PI + (Math.random() - 0.5) * 0.8;
    const speed = 0.2 + Math.random() * 0.4;
    const life = 0.3 + Math.random() * 0.3;
    state.particles.push({
      x: x - Math.cos(angle) * 0.1,
      y: y - Math.sin(angle) * 0.1,
      dx: Math.cos(backAngle) * speed,
      dy: Math.sin(backAngle) * speed,
      life,
      maxLife: life,
      size: 0.04 + Math.random() * 0.04,
      color,
      maxAlpha: 0.4,
    });
  }
}
