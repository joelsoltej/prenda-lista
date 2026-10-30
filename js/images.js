// Tratamiento de imágenes: redimensionar, recortar la prenda y montarla sobre césped artificial.

const BG_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
export const COVER_W = 1200;
export const COVER_H = 1600; // 3:4, el formato vertical de Vinted

let bgLib;

export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

const toBlob = (canvas, type = 'image/jpeg', q = 0.9) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, q));

// Reduce una foto a `max` píxeles en el lado largo (las fotos del móvil pesan mucho).
export async function resize(blob, max = 1600, q = 0.88) {
  const img = await loadImage(blob);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return toBlob(c, 'image/jpeg', q);
}

export async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// Recorta la prenda (PNG con transparencia). El modelo se descarga la primera vez (~40 MB) y luego queda en caché.
export async function cutout(blob, onProgress) {
  bgLib ??= await import(BG_LIB);
  const small = await resize(blob, 1600, 0.92);
  return bgLib.removeBackground(small, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (key, current, total) => onProgress?.(key, current, total),
  });
}

// Césped artificial visto desde arriba: hojas cortas en direcciones aleatorias sobre una base verde.
export function grassTexture(w = COVER_W, h = COVER_H, seed = Math.random() * 1e9) {
  let x = seed % 2147483647 || 1;
  const rnd = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#2f6b27';
  g.fillRect(0, 0, w, h);

  const blades = Math.round((w * h) / 26);
  g.lineCap = 'round';
  for (let i = 0; i < blades; i++) {
    const bx = rnd() * w, by = rnd() * h;
    const len = 9 + rnd() * 16;
    const a = rnd() * Math.PI * 2;
    const hue = 92 + rnd() * 26;
    const light = 22 + rnd() * 26 + (i / blades) * 8; // las de arriba más claras, da volumen
    g.strokeStyle = `hsl(${hue} ${42 + rnd() * 22}% ${light}%)`;
    g.lineWidth = 1.4 + rnd() * 1.8;
    g.beginPath();
    g.moveTo(bx, by);
    g.quadraticCurveTo(
      bx + Math.cos(a + 0.4) * len * 0.5, by + Math.sin(a + 0.4) * len * 0.5,
      bx + Math.cos(a) * len, by + Math.sin(a) * len,
    );
    g.stroke();
  }

  // Luz suave en el centro y bordes algo más oscuros, como una foto real.
  const v = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(255,255,230,0.07)');
  v.addColorStop(1, 'rgba(0,20,0,0.35)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  return c;
}

// Caja que encierra los píxeles visibles del recorte, para centrar la prenda.
function alphaBounds(img) {
  const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  return { x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
}

export async function composeOnGrass(cutoutBlob, { scale = 0.84, seed } = {}) {
  const img = await loadImage(cutoutBlob);
  const b = alphaBounds(img);
  const canvas = grassTexture(COVER_W, COVER_H, seed);
  const g = canvas.getContext('2d');
  const k = Math.min((COVER_W * scale) / b.w, (COVER_H * scale) / b.h);
  const dw = b.w * k, dh = b.h * k;
  const dx = (COVER_W - dw) / 2, dy = (COVER_H - dh) / 2;

  g.save();
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 34;
  g.shadowOffsetY = 14;
  g.drawImage(img, b.x, b.y, b.w, b.h, dx, dy, dw, dh);
  g.restore();
  return toBlob(canvas, 'image/jpeg', 0.9);
}
