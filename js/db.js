// Almacenamiento local: prendas en IndexedDB (incluye las fotos como Blob) y ajustes en localStorage.

const DB_NAME = 'prenda-lista';
const STORE = 'items';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const saveItem = (item) => tx('readwrite', (s) => s.put({ ...item, updated: Date.now() }));
export const deleteItem = (id) => tx('readwrite', (s) => s.delete(id));
export const getItem = (id) => tx('readonly', (s) => s.get(id));
export async function allItems() {
  const items = await tx('readonly', (s) => s.getAll());
  return items.sort((a, b) => b.created - a.created);
}

export const DEFAULTS = {
  apiKey: '',
  model: 'gemini-flash-latest',
  shopName: '',
  shipLine: '🚚 Envío el mismo día',
  lotDiscount: true,
  margin: 10,       // € que quieres ganar por prenda
  cushion: 3,       // € de colchón para negociar
  packCost: 0.1,    // € de embalaje por envío (bolsa XL de Action ≈ 0,08 €)
  shipAssumed: false,
  shipCost: 0,
  dailyGoal: 3,
  likeDiscount: 2,  // € menos en la oferta a quien da like
  grassScale: 0.84, // tamaño de la prenda sobre el césped
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function storeSettings(s) {
  try {
    localStorage.setItem('settings', JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
