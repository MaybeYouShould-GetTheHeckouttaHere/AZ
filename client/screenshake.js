import { state } from './state.js';

export function startScreenShake(duration, intensity) {
  state.shakeTimeLeft = duration;
  state.shakeIntensity = intensity;
}

export function getShakeOffset() {
  if (state.shakeTimeLeft <= 0) return { x: 0, y: 0 };
  const progress = state.shakeTimeLeft / 0.25;
  const mag = state.shakeIntensity * Math.min(1, progress);
  return {
    x: (Math.random() - 0.5) * 2 * mag,
    y: (Math.random() - 0.5) * 2 * mag,
  };
}
