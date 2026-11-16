// Procedural Canvas textures: every surface in Depot Nine is painted at runtime.
// No image files are shipped; the map's look comes from these generators.
import * as THREE from 'three';

function canvasTexture(size, painter, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  painter(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function speckle(ctx, size, count, colors, minR, maxR, alpha) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
    const r = minR + Math.random() * (maxR - minR);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function rustStreaks(ctx, size, count) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size * 0.6;
    const len = 20 + Math.random() * 90;
    const grad = ctx.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, 'rgba(90,40,16,0.55)');
    grad.addColorStop(1, 'rgba(90,40,16,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, 2 + Math.random() * 5, len);
  }
}

export function makeContainerTexture(base, dark, light) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    // Corrugated vertical ribs.
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = light;
      ctx.fillRect(x, 0, 3, s);
      ctx.fillStyle = dark;
      ctx.fillRect(x + 8, 0, 5, s);
    }
    rustStreaks(ctx, s, 26);
    speckle(ctx, s, 260, ['#2a1a10', '#000000', '#ffffff'], 0.5, 2.2, 0.25);
    // Stencilled bay number, small and flat on the wall (no floating text).
    ctx.fillStyle = 'rgba(240,235,220,0.75)';
    ctx.font = 'bold 34px monospace';
    ctx.fillText('D9-' + (10 + ((Math.random() * 80) | 0)), 18, 46);
  });
}

export function makeGroundTexture() {
  return canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#4a4238';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 2600, ['#38322a', '#5c5346', '#6b655c', '#2e2822'], 1, 4, 0.5);
    // Faint tyre tracks.
    ctx.strokeStyle = 'rgba(30,25,20,0.35)';
    ctx.lineWidth = 14;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + 20, s * 0.6, y - 20, s, y + 8);
      ctx.stroke();
    }
    // Oil stains.
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = 'rgba(15,12,10,0.35)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 18 + Math.random() * 40, 10 + Math.random() * 22, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 8, 8);
}

export function makeConcreteTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#6b655c';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 1800, ['#57514a', '#7d766c', '#4a443c'], 0.5, 2.5, 0.4);
    ctx.strokeStyle = 'rgba(40,36,30,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });
}

export function makeHazardTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#c8932a';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#1c1a17';
    for (let i = -s; i < s * 2; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, s);
      ctx.lineTo(i + 32, 0);
      ctx.lineTo(i + 64, 0);
      ctx.lineTo(i + 32, s);
      ctx.closePath();
      ctx.fill();
    }
    speckle(ctx, s, 200, ['#000000'], 0.5, 2, 0.2);
  });
}

export function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#232742');
  grad.addColorStop(0.45, '#5a4258');
  grad.addColorStop(0.72, '#c96a2e');
  grad.addColorStop(1, '#e07830');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 256);
  // Low sun disc and a few thin clouds.
  ctx.fillStyle = 'rgba(255,196,120,0.95)';
  ctx.beginPath();
  ctx.arc(700, 178, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,220,180,0.35)';
  ctx.beginPath();
  ctx.arc(700, 178, 44, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = 'rgba(60,45,70,0.35)';
    const y = 40 + Math.random() * 90;
    ctx.fillRect(Math.random() * 1024, y, 120 + Math.random() * 200, 5 + Math.random() * 8);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
