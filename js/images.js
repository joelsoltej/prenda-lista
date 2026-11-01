// Tratamiento de imágenes: redimensionar, recortar la prenda y montarla sobre césped artificial.

const BG_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
const GRASS_FILES = ['img/grass-1.jpg', 'img/grass-2.jpg'];
export const COVER_W = 1200;
export const COVER_H = 1600; // 3:4, el formato vertical de Vinted

let bgLib;
const grassImages = new Map();

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

async function grassImage(file) {
  if (!grassImages.has(file)) {
    const res = await fetch(file);
    if (!res.ok) throw new Error('No se pudo cargar el césped');
    grassImages.set(file, await loadImage(await res.blob()));
  }
  return grassImages.get(file);
}

// Césped real sacado de una foto. Hay 8 variantes: 2 texturas, volteadas en horizontal y en vertical.
async function grassTexture(variant) {
  const v = Math.abs(Math.trunc(variant)) % 8;
  const img = await grassImage(GRASS_FILES[v & 1]);
  const c = document.createElement('canvas');
  c.width = COVER_W; c.height = COVER_H;
  const g = c.getContext('2d');
  g.translate(v & 2 ? COVER_W : 0, v & 4 ? COVER_H : 0);
  g.scale(v & 2 ? -1 : 1, v & 4 ? -1 : 1);
  g.drawImage(img, 0, 0, COVER_W, COVER_H);
  g.setTransform(1, 0, 0, 1, 0, 0);

  // Bordes un poco más oscuros, como en una foto real.
  const shade = g.createRadialGradient(COVER_W / 2, COVER_H * 0.45, COVER_H * 0.3, COVER_W / 2, COVER_H / 2, COVER_H * 0.8);
  shade.addColorStop(0, 'rgba(0,20,0,0)');
  shade.addColorStop(1, 'rgba(0,20,0,0.22)');
  g.fillStyle = shade;
  g.fillRect(0, 0, COVER_W, COVER_H);
  return c;
}

// Lee la transparencia del recorte: la caja que encierra la prenda y qué parte de la foto era fondo.
function alphaInfo(img) {
  const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, visible = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        visible++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const bounds = x1 < 0
    ? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
    : { x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
  return { bounds, backgroundShare: 1 - visible / (w * h) };
}

// En un primer plano la prenda llena el encuadre: no hay fondo que cambiar y el recorte, además, se suele
// comer el tejido y deja solo un trozo. Por eso, si queda menos del 25 % de la foto, se deja la original.
export async function hasBackground(cutoutBlob) {
  const { backgroundShare } = alphaInfo(await loadImage(cutoutBlob));
  return backgroundShare > 0.05 && backgroundShare < 0.75;
}

export async function composeOnGrass(cutoutBlob, { scale = 0.84, variant = 0 } = {}) {
  const img = await loadImage(cutoutBlob);
  const b = alphaInfo(img).bounds;
  const canvas = await grassTexture(variant);
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
