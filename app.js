import { saveItem, deleteItem, getItem, allItems, loadSettings, storeSettings, DEFAULTS } from './js/db.js';
import { cutout, composeOnGrass, resize } from './js/images.js';
import { analyze, listModels, ESTADOS } from './js/ai.js';
import { startAppleEmoji } from './js/emoji.js';

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const eur = (n) => (n == null ? '—' : `${(Math.round(n * 100) / 100).toLocaleString('es-ES')} €`);
const DAY = 86400000;
const daysSince = (t) => (t ? Math.floor((Date.now() - t) / DAY) : 0);
const urls = new WeakMap();
const urlOf = (blob) => { if (!blob) return ''; if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob)); return urls.get(blob); };
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

let settings = loadSettings();
let cur = null;          // prenda abierta en el editor
let tab = 'nueva';
let filter = 'borrador';
let saveTimer;

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}

async function copy(text, label = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(`✓ ${label}`);
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => cur && saveItem(cur), 400);
}

// Formulario modal sencillo; devuelve los valores o null si se cancela.
function ask(title, fields, okText = 'Guardar') {
  const dlg = $('#modal'), form = $('#modalForm');
  form.innerHTML = `<h2 style="margin-top:0">${esc(title)}</h2>
    ${fields.map((f) => `<label>${esc(f.label)}</label><input name="${f.name}" inputmode="decimal" value="${esc(f.value ?? '')}">`).join('')}
    <div class="btns" style="justify-content:flex-end"><button class="btn" value="cancel">Cancelar</button><button class="btn primary" value="ok">${esc(okText)}</button></div>`;
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve(Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value])));
    };
  });
}

// ---------- modelo de prenda ----------
function newItem() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
    created: Date.now(),
    status: 'borrador',
    photos: [],
    cutout: null,
    cover: null,
    useCover: true,
    known: { marca: '', talla: '', material: '', pais: '', defectos: '', notas: '' },
    ai: null,
    title: '',
    body: '',
    hashtags: '',
    description: '',
    descEdited: false,
    ficha: { categoria: '', marca: '', talla: '', estado: '', nota: 9, colores: '', material: '', pais: '', medidas: '', defectos: '', paquete: 'Mediano' },
    price: { coste: '', final: '' },
    publishedAt: null,
    soldAt: null,
    soldPrice: null,
    soldShip: null,
  };
}

// Fotos en el orden en que se suben a Vinted: portada con césped (si está activada) y después las reales.
function exportPhotos(it) {
  const rest = it.photos.slice(1);
  const first = it.cover && it.useCover ? it.cover : it.photos[0];
  return first ? [first, ...rest] : [];
}

function buildDescription(it) {
  const f = it.ficha;
  const tags = it.hashtags.split(/[\s,]+/).map((t) => t.replace(/^#+/, '')).filter(Boolean);
  const nota = num(f.nota);
  const lines = [
    `✅ Estado ${nota == null ? '[COMPLETAR]' : String(nota).replace('.', ',')}/10`,
    `👉 ${it.body || '[COMPLETAR]'}`,
    `📐 Talla ${f.talla || '[COMPLETAR]'} (comprobar medidas)`,
    f.medidas.trim() ? `📏 Medidas: ${f.medidas.trim()} (en las últimas imágenes)` : '📏 Medidas en las últimas imágenes',
    f.defectos.trim() ? `⚠️ Defectos: ${f.defectos.trim()} (se ven en las fotos)` : '❌ SIN manchas, rotos o descosidos',
  ];
  if (settings.shipLine.trim()) lines.push(settings.shipLine.trim());
  if (settings.lotDiscount) lines.push('🚀 Descuento por lote activo!!');
  return lines.join('\n') + (tags.length ? '\n\n' + tags.map((t) => '#' + t).join(' ') : '');
}

// Precio según la guía: salida = coste real + margen + colchón; mínimo = coste real + margen.
// Se ajusta a la franja de mercado que estima la IA, sin pasarse de ella.
function priceCalc(it) {
  const coste = num(it.price.coste);
  const extra = settings.packCost + (settings.shipAssumed ? settings.shipCost : 0);
  const real = coste == null ? null : coste + extra;
  const minimo = real == null ? null : Math.ceil(real + settings.margin);
  const salida = minimo == null ? null : Math.ceil(minimo + settings.cushion);
  const ai = it.ai;
  let rec = salida;
  if (ai) {
    const hi = Math.round(ai.precio_max), aiRec = Math.round(ai.precio_recomendado);
    if (salida == null) rec = aiRec;
    else if (salida > hi) rec = hi;
    else rec = Math.max(salida, Math.min(aiRec, hi));
  }
  return { real, minimo, salida, rec };
}

function warnings(it) {
  const out = [];
  const all = [it.title, it.description, ...Object.values(it.ficha)].join(' ');
  const pend = (all.match(/\[COMPLETAR\]/g) || []).length;
  if (pend) out.push(`Hay ${pend} [COMPLETAR]: rellénalos con los datos de la etiqueta.`);
  const risky = ['Made in', 'Premium', 'Limited Edition', 'Genuine', 'Original', 'Rare'].filter((w) => it.title.toLowerCase().includes(w.toLowerCase()));
  if (risky.length) out.push(`El título dice "${risky.join('", "')}": déjalo solo si es verdad.`);
  if (it.title && !/^vintage/i.test(it.title.trim())) out.push('La guía recomienda que el título empiece por "Vintage".');
  if (it.photos.length && it.photos.length < 5) out.push('Pocas fotos: la guía recomienda 1 principal, unas 6 de detalle y 1 con el metro.');
  for (const a of it.ai?.avisos || []) out.push(a);
  return out;
}

// ---------- navegación ----------
function go(t) {
  tab = t;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  window.scrollTo(0, 0);
  render();
}

// Las pantallas que leen de la base de datos dibujan en un contenedor nuevo; si mientras tanto
// se ha cambiado de pestaña, el resultado se descarta para no pisar la pantalla actual.
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const v = document.createElement('div');
  const commit = () => { if (seq === renderSeq) $('#view').replaceChildren(...v.childNodes); };
  if (tab === 'nueva') {
    if (!cur) cur = newItem();
    $('#topinfo').textContent = '';
    $('#view').replaceChildren(v);
    renderEditor(v);
    return;
  }
  await renderTab(v);
  commit();
}

async function renderTab(v) {
  $('#topinfo').textContent = '';
  if (tab === 'prendas') return renderList(v);
  if (tab === 'registro') return renderRecord(v);
  if (tab === 'mensajes') return renderMessages(v);
  if (tab === 'ajustes') return renderSettings(v);
}

// ---------- editor ----------
function renderEditor(v) {
  const it = cur;
  const f = it.ficha;
  $('#title').textContent = it.status === 'borrador' ? 'Nueva prenda' : 'Editar prenda';
  $('#topinfo').innerHTML = `<button class="btn sm" data-act="new">➕ Otra</button>`;
  const estadoOpts = ['', ...ESTADOS].map((e) => `<option ${e === f.estado ? 'selected' : ''} value="${esc(e)}">${e || 'Elige estado'}</option>`).join('');
  const paqOpts = ['Pequeño', 'Mediano', 'Grande'].map((p) => `<option ${p === f.paquete ? 'selected' : ''}>${p}</option>`).join('');
  const inp = (path, label, ph = '') => `<div><label>${label}</label><input data-bind="${path}" value="${esc(getPath(it, path))}" placeholder="${esc(ph)}"></div>`;

  v.innerHTML = `
  <section class="card">
    <h2><span class="step">1</span>Fotos</h2>
    <p class="muted">Orden de la guía: 1 principal desde arriba, unas 6 de detalle (etiqueta, tejido, cuello, costuras, defectos) y la del metro al final.</p>
    <div id="photos"></div>
    <div class="btns">
      <label class="btn primary" style="margin:0;color:#fff">📷 Cámara<input type="file" accept="image/*" capture="environment" hidden data-act="addphotos"></label>
      <label class="btn" style="margin:0;color:var(--text)">🖼️ Galería<input type="file" accept="image/*" multiple hidden data-act="addphotos"></label>
    </div>
  </section>

  <section class="card">
    <h2><span class="step">2</span>Portada con césped</h2>
    <p class="muted">Se recorta la prenda de la foto principal y se pone sobre césped artificial. Las demás fotos se suben tal cual, para que se vea el estado real.</p>
    <div id="cover"></div>
  </section>

  <section class="card">
    <h2><span class="step">3</span>Lo que la foto no muestra <span class="muted small">(opcional)</span></h2>
    <div class="row">${inp('known.marca', 'Marca')}${inp('known.talla', 'Talla')}</div>
    <div class="row">${inp('known.material', 'Material', '100% algodón')}${inp('known.pais', 'País etiqueta')}</div>
    <label>Defectos</label><input data-bind="known.defectos" value="${esc(it.known.defectos)}" placeholder="p. ej. pequeña mancha en la manga">
    <label>Notas</label><input data-bind="known.notas" value="${esc(it.known.notas)}" placeholder="años 90, edición especial...">
    <button class="btn primary block" data-act="ai" ${it.photos.length ? '' : 'disabled'}>✨ Generar título, descripción, estado y precio</button>
    <div id="aistatus"></div>
  </section>

  <section class="card">
    <h2><span class="step">4</span>Título y descripción</h2>
    <label>Título <span class="muted small" id="tcount"></span></label>
    <textarea data-bind="title" rows="3" style="min-height:70px">${esc(it.title)}</textarea>
    <label>Frase de la prenda (línea 👉)</label>
    <textarea data-bind="body" rows="3" style="min-height:70px">${esc(it.body)}</textarea>
    <label>Hashtags</label>
    <textarea data-bind="hashtags" rows="2" style="min-height:60px">${esc(it.hashtags)}</textarea>
    <label>Descripción final <span class="muted small">${it.descEdited ? '(editada a mano)' : '(se monta sola)'}</span></label>
    <textarea data-bind="description" id="desc" rows="10">${esc(it.description || buildDescription(it))}</textarea>
    <div class="btns"><button class="btn sm" data-act="rebuild">↻ Rehacer desde la ficha</button></div>
    <div id="warns"></div>
  </section>

  <section class="card">
    <h2><span class="step">5</span>Ficha de Vinted</h2>
    ${inp('ficha.categoria', 'Categoría', 'Hombre > Ropa > ...')}
    <div class="row">${inp('ficha.marca', 'Marca')}${inp('ficha.talla', 'Talla')}</div>
    <div class="row">
      <div><label>Estado</label><select data-bind="ficha.estado">${estadoOpts}</select></div>
      <div><label>Nota /10 (descripción)</label><input data-bind="ficha.nota" inputmode="decimal" value="${esc(f.nota)}"></div>
    </div>
    <p class="muted small" id="estmotivo">${esc(it.ai?.estado_motivo || '')}</p>
    <div class="row">${inp('ficha.colores', 'Color(es)')}${inp('ficha.material', 'Material')}</div>
    ${inp('ficha.medidas', 'Medidas', 'Axila a axila 56 cm · Largo 70 cm')}
    ${inp('ficha.defectos', 'Defectos (vacío = sin defectos)')}
    <div class="row">${inp('ficha.pais', 'País de fabricación')}<div><label>Tamaño del paquete</label><select data-bind="ficha.paquete">${paqOpts}</select></div></div>
  </section>

  <section class="card">
    <h2><span class="step">6</span>Precio</h2>
    <div class="row">
      <div><label>Lo que te costó (€)</label><input data-bind="price.coste" inputmode="decimal" value="${esc(it.price.coste)}"></div>
      <div><label>Precio final (€)</label><input data-bind="price.final" inputmode="decimal" value="${esc(it.price.final)}"></div>
    </div>
    <button class="btn sm" data-act="lote" style="margin-top:8px">📦 Viene de un lote o por kilo</button>
    <div id="pricebox"></div>
  </section>

  <section class="card">
    <h2><span class="step">7</span>Subir a Vinted</h2>
    <ol class="muted" style="padding-left:18px;margin:0">
      <li>Comparte las fotos a Vinted (o guárdalas en la galería).</li>
      <li>Copia el título y la descripción y pégalos.</li>
      <li>Rellena la ficha con los botones de copiar.</li>
    </ol>
    <div class="btns">
      <button class="btn primary" data-act="share">📤 Compartir fotos</button>
      <button class="btn" data-act="download">⬇️ Guardar fotos</button>
      <a class="btn" href="https://www.vinted.es/items/new" target="_blank" rel="noopener">Abrir Vinted ↗</a>
    </div>
    <div class="btns">
      <button class="btn" data-act="copy" data-what="title">📋 Título</button>
      <button class="btn" data-act="copy" data-what="description">📋 Descripción</button>
    </div>
    <div id="fichacopy" style="margin-top:10px"></div>
    <button class="btn primary block" data-act="publish">${it.status === 'borrador' ? '✅ Marcar como publicada' : '💾 Guardar cambios'}</button>
    ${it.status !== 'borrador' ? '' : '<button class="btn block" data-act="savedraft">Guardar borrador</button>'}
    ${it.created && it.updated ? '<button class="btn block" data-act="delete" style="color:var(--danger)">Eliminar prenda</button>' : ''}
  </section>`;

  renderPhotos();
  renderCover();
  refreshDerived();
}

function renderPhotos() {
  const el = $('#photos');
  if (!el) return;
  const n = cur.photos.length;
  el.innerHTML = n
    ? `<div class="photos">${cur.photos.map((p, i) => `
        <div class="ph"><img src="${urlOf(p)}" alt="Foto ${i + 1}">
          <span class="tag">${i === 0 ? 'Principal' : i === n - 1 && n > 2 ? 'Medidas?' : i + 1}</span>
          <div class="ctrls">
            <button data-act="mv" data-i="${i}" data-d="-1" aria-label="Mover antes">◀</button>
            <button data-act="rm" data-i="${i}" aria-label="Quitar">✕</button>
            <button data-act="mv" data-i="${i}" data-d="1" aria-label="Mover después">▶</button>
          </div></div>`).join('')}</div>`
    : '<div class="photo-empty"><span class="big">📸</span>Aún no hay fotos de esta prenda</div>';
  const aiBtn = $('[data-act="ai"]');
  if (aiBtn) aiBtn.disabled = !n;
}

function renderCover(progress) {
  const el = $('#cover');
  if (!el) return;
  if (!cur.photos.length) { el.innerHTML = '<p class="muted">Primero añade la foto principal.</p>'; return; }
  if (progress != null) {
    el.innerHTML = `<p class="muted"><span class="spin"></span> ${esc(progress.text)}</p><div class="progress"><div style="width:${progress.pct}%"></div></div>`;
    return;
  }
  el.innerHTML = cur.cover
    ? `<div class="cover-preview">
         <figure><img src="${urlOf(cur.photos[0])}" alt="Original"><figcaption>Original</figcaption></figure>
         <figure><img src="${urlOf(cur.cover)}" alt="Con césped"><figcaption>Con césped</figcaption></figure>
       </div>
       <label class="check" style="margin-top:10px"><input type="checkbox" data-act="usecover" ${cur.useCover ? 'checked' : ''}> Usar la de césped como portada</label>
       <label>Tamaño de la prenda</label><input type="range" min="0.6" max="0.96" step="0.02" value="${settings.grassScale}" data-act="scale">
       <div class="btns"><button class="btn sm" data-act="regrass">🌱 Otro césped</button><button class="btn sm" data-act="cutout">↻ Recortar de nuevo</button></div>
       <p class="muted small">Compara las dos: si el recorte se ha comido parte de la prenda o cambia algo, usa la original.</p>`
    : `<button class="btn primary block" data-act="cutout">🌱 Poner césped a la portada</button>
       <p class="muted small">La primera vez descarga el modelo de recorte (~40 MB, mejor con wifi). Después funciona sin conexión.</p>`;
}

// Actualiza lo que depende de otros campos sin redibujar el editor (para no perder el foco).
function refreshDerived() {
  const it = cur;
  if (!it.descEdited) {
    it.description = buildDescription(it);
    const d = $('#desc');
    if (d && document.activeElement !== d) d.value = it.description;
  }
  const tc = $('#tcount');
  if (tc) tc.textContent = `${it.title.length} caracteres`;

  const w = warnings(it);
  const wEl = $('#warns');
  if (wEl) wEl.innerHTML = w.length ? `<div class="alert">Antes de publicar, revisa:<ul>${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : (it.title ? '<div class="alert ok">✓ Todo listo para publicar</div>' : '');

  const p = priceCalc(it);
  const pb = $('#pricebox');
  if (pb) {
    const ai = it.ai;
    pb.innerHTML = `
      <div class="price-box">
        <div><b>${eur(p.minimo)}</b><span>Tu mínimo</span></div>
        <div><b>${eur(p.rec)}</b><span>Recomendado</span></div>
        <div><b>${ai ? `${Math.round(ai.precio_min)}-${Math.round(ai.precio_max)} €` : '—'}</b><span>Mercado (IA)</span></div>
      </div>
      ${p.real != null ? `<p class="muted small">Coste real ${eur(p.real)} (prenda + embalaje${settings.shipAssumed ? ' + envío' : ''}) · margen ${eur(settings.margin)} · colchón ${eur(settings.cushion)}</p>` : '<p class="muted small">Pon lo que te costó para calcular tu mínimo y tu margen.</p>'}
      ${ai?.precio_motivo ? `<p class="muted small">IA: ${esc(ai.precio_motivo)} Compruébalo buscando prendas iguales vendidas en Vinted.</p>` : ''}
      ${p.rec != null && String(p.rec) !== String(it.price.final) ? `<button class="btn sm" data-act="userec">Usar ${eur(p.rec)}</button>` : ''}
      ${p.salida != null && ai && p.salida > ai.precio_max ? `<div class="alert">Con tu margen saldría a ${eur(p.salida)}, por encima del mercado. Valora ganar menos o meterla en un lote.</div>` : ''}`;
  }

  const fc = $('#fichacopy');
  if (fc) {
    const f = it.ficha;
    const rows = [['Marca', f.marca], ['Talla', f.talla], ['Estado', f.estado], ['Color', f.colores], ['Material', f.material], ['Categoría', f.categoria], ['Paquete', f.paquete], ['Precio', it.price.final && `${it.price.final}`]];
    fc.innerHTML = `<table>${rows.map(([k, val]) => `<tr><th>${k}</th><td>${esc(val || '—')}</td><td class="n">${val ? `<button class="btn sm" data-act="copyval" data-v="${esc(val)}">📋</button>` : ''}</td></tr>`).join('')}</table>`;
  }
}

function applyAI(r) {
  const it = cur, f = it.ficha, k = it.known;
  it.ai = r;
  it.title = r.titulo;
  it.body = r.descripcion_prenda;
  it.hashtags = (r.hashtags || []).map((t) => '#' + t.replace(/^#+/, '').replace(/\s+/g, '')).join(' ');
  f.categoria = r.categoria_vinted;
  f.marca = k.marca || r.marca;
  f.talla = k.talla || r.talla;
  f.material = k.material || r.material;
  f.pais = k.pais || r.pais_fabricacion;
  f.estado = r.estado_vinted;
  f.nota = r.estado_nota;
  f.colores = (r.colores || []).join(', ');
  f.medidas = (r.medidas || []).map((m) => `${m.nombre} ${m.cm} cm`).join(' · ');
  f.defectos = k.defectos || (r.defectos || []).join(', ');
  f.paquete = r.paquete || f.paquete;
  it.descEdited = false;
  if (!it.price.final) it.price.final = String(priceCalc(it).rec ?? '');
}

async function runAI() {
  const st = $('#aistatus');
  const btn = $('[data-act="ai"]');
  btn.disabled = true;
  st.innerHTML = '<p class="muted"><span class="spin"></span> Analizando las fotos con Gemini...</p>';
  try {
    const r = await analyze(cur.photos, cur.known, settings);
    applyAI(r);
    await saveItem(cur);
    renderEditor($('#view'));
    toast('✓ Listo. Revisa los textos y la ficha');
    $('[data-bind="title"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    st.innerHTML = `<div class="alert">${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

async function runCutout() {
  const labels = { fetch: 'Descargando modelo de recorte', compute: 'Recortando la prenda' };
  renderCover({ text: 'Preparando...', pct: 2 });
  try {
    cur.cutout = await cutout(cur.photos[0], (key, c, t) => {
      const kind = key.startsWith('fetch') ? 'fetch' : 'compute';
      renderCover({ text: labels[kind] + '...', pct: t ? Math.round((c / t) * 100) : 50 });
    });
    renderCover({ text: 'Poniendo el césped...', pct: 100 });
    cur.cover = await composeOnGrass(cur.cutout, { scale: settings.grassScale });
    cur.useCover = true;
    saveSoon();
  } catch (e) {
    console.error(e);
    toast('No se pudo recortar: ' + e.message, 4000);
  }
  renderCover();
}

async function regrass() {
  if (!cur.cutout) return runCutout();
  cur.cover = await composeOnGrass(cur.cutout, { scale: settings.grassScale });
  saveSoon();
  renderCover();
}

async function sharePhotos() {
  const files = exportPhotos(cur).map((b, i) => new File([b], `prenda-${i + 1}.jpg`, { type: b.type || 'image/jpeg' }));
  if (!files.length) return toast('No hay fotos');
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
    } catch (e) {
      if (e.name !== 'AbortError') toast('No se pudo compartir: ' + e.message);
    }
  } else {
    toast('Tu navegador no deja compartir fotos; se descargan');
    downloadPhotos();
  }
}

function downloadPhotos() {
  exportPhotos(cur).forEach((b, i) => {
    setTimeout(() => {
      const a = Object.assign(document.createElement('a'), { href: urlOf(b), download: `prenda-${i + 1}.jpg` });
      document.body.append(a); a.click(); a.remove();
    }, i * 350);
  });
}

async function addPhotos(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  toast(`Añadiendo ${files.length} foto${files.length > 1 ? 's' : ''}...`);
  const hadMain = cur.photos.length > 0;
  for (const f of files) cur.photos.push(await resize(f, 1600, 0.88));
  if (!hadMain) { cur.cover = null; cur.cutout = null; }
  saveSoon();
  renderPhotos();
  renderCover();
  refreshDerived();
}

// ---------- lista de prendas ----------
async function renderList(v) {
  $('#title').textContent = 'Mis prendas';
  const items = await allItems();
  const today = new Date().setHours(0, 0, 0, 0);
  const pubToday = items.filter((i) => i.publishedAt >= today).length;
  $('#topinfo').textContent = `Hoy: ${pubToday}/${settings.dailyGoal}`;
  const counts = { borrador: 0, publicado: 0, vendido: 0 };
  items.forEach((i) => counts[i.status]++);
  const shown = items.filter((i) => i.status === filter);
  const names = { borrador: 'Borradores', publicado: 'En venta', vendido: 'Vendidas' };

  v.innerHTML = `
    <div class="filters">${Object.keys(names).map((k) => `<button class="btn sm ${k === filter ? 'on' : ''}" data-act="filter" data-f="${k}">${names[k]} (${counts[k]})</button>`).join('')}</div>
    ${filter === 'borrador' && counts.borrador ? `<p class="muted">Publica en tandas de 3 seguidas, repartidas en el día (mañana, mediodía, tarde-noche). Hoy llevas ${pubToday} de ${settings.dailyGoal}.</p>` : ''}
    <div class="list">${shown.length ? shown.map(itemCard).join('') : `<p class="empty"><span class="big">${{ borrador: '🧺', publicado: '🏷️', vendido: '💸' }[filter]}</span>No hay prendas en "${names[filter]}"</p>`}</div>`;
}

function itemCard(i) {
  const thumb = (i.cover && i.useCover ? i.cover : i.photos[0]);
  const d = daysSince(i.publishedAt);
  const chips = [];
  if (i.price.final) chips.push(`<span class="chip">${esc(i.price.final)} €</span>`);
  if (i.ficha.talla) chips.push(`<span class="chip">${esc(i.ficha.talla)}</span>`);
  if (i.status === 'publicado') {
    chips.push(`<span class="chip">${d === 0 ? 'hoy' : `hace ${d} d`}</span>`);
    if (d >= 60) chips.push('<span class="chip warn">Métela en un lote</span>');
    else if (d >= 21) chips.push('<span class="chip warn">Revisa fotos y título, baja poco a poco</span>');
    else if (d >= 3) chips.push('<span class="chip warn">Destácala 3 días</span>');
  }
  if (i.status === 'vendido') chips.push(`<span class="chip green">Vendida ${esc(i.soldPrice)} €</span>`);
  return `<button class="item" data-act="open" data-id="${i.id}">
    ${thumb ? `<img src="${urlOf(thumb)}" alt="">` : '<div class="noimg"></div>'}
    <div><div class="t">${esc(i.title || 'Sin título')}</div><div class="chips">${chips.join('')}</div></div>
  </button>`;
}

// ---------- registro ----------
function profit(i) {
  return num(i.soldPrice) - (num(i.price.coste) || 0) - settings.packCost - (num(i.soldShip) || 0);
}

async function renderRecord(v) {
  $('#title').textContent = 'Registro';
  const items = await allItems();
  const sold = items.filter((i) => i.status === 'vendido');
  const onSale = items.filter((i) => i.status === 'publicado');
  const invested = items.reduce((s, i) => s + (num(i.price.coste) || 0), 0);
  const income = sold.reduce((s, i) => s + (num(i.soldPrice) || 0), 0);
  const benefit = sold.reduce((s, i) => s + profit(i), 0);
  const stuck = onSale.filter((i) => daysSince(i.publishedAt) >= 21);
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const soldMonth = sold.filter((i) => i.soldAt >= month.getTime());

  v.innerHTML = `
    <div class="stats">
      <div class="stat hero"><b>${eur(benefit)}</b><span>💰 Beneficio total</span></div>
      <div class="stat"><b>${eur(soldMonth.reduce((s, i) => s + profit(i), 0))}</b><span>Beneficio este mes</span></div>
      <div class="stat"><b>${sold.length}</b><span>Vendidas (${soldMonth.length} este mes)</span></div>
      <div class="stat"><b>${onSale.length}</b><span>En venta</span></div>
      <div class="stat"><b>${eur(income)}</b><span>Ingresos</span></div>
      <div class="stat"><b>${eur(invested)}</b><span>Invertido en prendas</span></div>
      <div class="stat"><b>${sold.length ? eur(benefit / sold.length) : '—'}</b><span>Beneficio medio por prenda</span></div>
    </div>
    ${stuck.length ? `<div class="alert" style="margin-bottom:14px">${stuck.length} prenda${stuck.length > 1 ? 's llevan' : ' lleva'} 3 semanas o más sin venderse (${eur(stuck.reduce((s, i) => s + (num(i.price.coste) || 0), 0))} parados). Revisa fotos y título y baja el precio poco a poco.</div>` : ''}
    <section class="card">
      <h2>Ventas</h2>
      ${sold.length ? `<table><tr><th>Prenda</th><th class="n">Coste</th><th class="n">Venta</th><th class="n">Benef.</th></tr>
        ${sold.map((i) => `<tr><td>${esc((i.title || 'Sin título').slice(0, 38))}</td><td class="n">${eur(num(i.price.coste))}</td><td class="n">${eur(num(i.soldPrice))}</td><td class="n"><b>${eur(profit(i))}</b></td></tr>`).join('')}</table>`
        : '<p class="muted">Aún no hay ventas. Cuando vendas, abre la prenda en "En venta" y pulsa "Marcar como vendida".</p>'}
      <button class="btn block" data-act="csv">⬇️ Exportar a CSV (Excel)</button>
    </section>
    <p class="muted small">Si vendes con frecuencia, la guía recomienda informarte sobre tus obligaciones con Hacienda.</p>`;
}

async function exportCSV() {
  const items = await allItems();
  const head = ['Título', 'Marca', 'Talla', 'Estado', 'Situación', 'Coste', 'Precio publicado', 'Precio venta', 'Envío asumido', 'Beneficio', 'Publicada', 'Vendida'];
  const d = (t) => (t ? new Date(t).toLocaleDateString('es-ES') : '');
  const rows = items.map((i) => [i.title, i.ficha.marca, i.ficha.talla, i.ficha.estado, i.status, i.price.coste, i.price.final, i.soldPrice ?? '', i.soldShip ?? '',
    i.status === 'vendido' ? profit(i).toFixed(2).replace('.', ',') : '', d(i.publishedAt), d(i.soldAt)]);
  const csv = '﻿' + [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'registro-vinted.csv' });
  a.click();
}

// ---------- mensajes ----------
async function renderMessages(v, selId) {
  $('#title').textContent = 'Mensajes';
  const items = (await allItems()).filter((i) => i.status === 'publicado');
  const sel = items.find((i) => i.id === selId) || items[0];
  const precio = num(sel?.price.final);
  const minimo = sel ? priceCalc(sel).minimo : null;
  const oferta = precio != null ? Math.max(0, precio - settings.likeDiscount) : null;
  const P = (n, fallback) => (n == null ? fallback : `${n} €`);
  const msgs = [
    ['A quien da like', `Hola!! Acabo de ver que te ha gustado la prenda, te quería comentar que estoy preparando los envíos, así que si la quieres comprar te la puedo enviar y te llegaría lo antes posible. Además te dejo una oferta!!`,
      `Justo después, envíale una oferta de ${P(oferta, `${settings.likeDiscount} € menos`)}.`],
    ['Contraoferta amable', `¡Hola! Gracias por la oferta 😊 Lo mínimo que puedo dejarla es en ${P(minimo, '[tu mínimo]')}. Si te encaja, te la envío hoy mismo.`,
      'Para ofertas muy bajas. Si no responde, no insistas.'],
    ['Lote', `¡Hola! Si te interesa alguna otra prenda de mi perfil, te hago descuento por lote y te ahorras pagar otro envío 😉`, ''],
    ['Pedido enviado', `¡Hola! Ya te he enviado el pedido, en unos días lo tendrás. ¡Gracias por tu compra!`, 'Antes, haz una foto del paquete cerrado con la etiqueta.'],
    ['Después de la venta', `¡Muchas gracias por tu compra! Espero que la disfrutes mucho. Ya te he dejado mi reseña 🙏`, ''],
  ];
  v.innerHTML = `
    ${items.length ? `<label>Prenda (para calcular la oferta)</label><select data-act="msgitem">${items.map((i) => `<option value="${i.id}" ${i === sel ? 'selected' : ''}>${esc((i.title || 'Sin título').slice(0, 50))} · ${esc(i.price.final)} €</option>`).join('')}</select><div style="height:12px"></div>` : ''}
    ${msgs.map(([t, m, tip]) => `<section class="card"><h2>${t}</h2><div class="msg">${esc(m)}</div>${tip ? `<p class="muted small">${esc(tip)}</p>` : ''}<button class="btn sm" data-act="copyval" data-v="${esc(m)}" style="margin-top:8px">📋 Copiar</button></section>`).join('')}
    <p class="muted small">La guía avisa: un mensaje a quien da like está bien, pero no mandes mensajes repetidos a cientos de usuarios. Y nada de cerrar ventas fuera de Vinted.</p>`;
}

// ---------- ajustes ----------
function renderSettings(v) {
  $('#title').textContent = 'Ajustes';
  const s = settings;
  const field = (k, label, type = 'text', extra = '') => `<label>${label}</label><input data-set="${k}" type="${type}" value="${esc(s[k])}" ${extra}>`;
  const check = (k, label) => `<label class="check" style="margin-top:12px"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}> ${label}</label>`;
  v.innerHTML = `
    <section class="card">
      <h2>Gemini</h2>
      <p class="muted">Crea una clave gratis en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> y pégala aquí. Se guarda solo en este móvil.</p>
      ${field('apiKey', 'Clave de API', 'password', 'autocomplete="off"')}
      ${field('model', 'Modelo', 'text', 'list="models"')}<datalist id="models"></datalist>
      <button class="btn block" data-act="testkey">Probar clave</button>
      <div id="keystatus"></div>
    </section>
    <section class="card">
      <h2>Mi tienda</h2>
      ${field('shopName', 'Nombre de la tienda')}
      ${field('shipLine', 'Línea de envío en la descripción')}
      <p class="muted small">Promete solo lo que cumples: si no envías el mismo día, pon tu plazo real (p. ej. "🚚 Envío en 24-48 h").</p>
      ${check('lotDiscount', 'Tengo el descuento por lote activo')}
    </section>
    <section class="card">
      <h2>Precios</h2>
      <div class="row">
        <div>${field('margin', 'Lo que quiero ganar (€)', 'text', 'inputmode="decimal"')}</div>
        <div>${field('cushion', 'Colchón para negociar (€)', 'text', 'inputmode="decimal"')}</div>
      </div>
      <div class="row">
        <div>${field('packCost', 'Embalaje por envío (€)', 'text', 'inputmode="decimal"')}</div>
        <div>${field('likeDiscount', 'Descuento oferta a likes (€)', 'text', 'inputmode="decimal"')}</div>
      </div>
      ${check('shipAssumed', 'Pago yo el envío')}
      ${field('shipCost', 'Coste del envío (€)', 'text', 'inputmode="decimal"')}
      ${field('dailyGoal', 'Prendas a publicar al día (3-9)', 'text', 'inputmode="numeric"')}
    </section>
    <section class="card">
      <h2>Instalar en el móvil</h2>
      <p class="muted">Android (Chrome): menú ⋮ → "Añadir a pantalla de inicio". iPhone (Safari): botón Compartir → "Añadir a pantalla de inicio".</p>
      <button class="btn block" data-act="install" ${installEvt ? '' : 'hidden'}>📲 Instalar app</button>
    </section>`;
}

const NUM_SETTINGS = ['margin', 'cushion', 'packCost', 'shipCost', 'likeDiscount', 'dailyGoal'];

// ---------- eventos ----------
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.bind && cur) {
    setPath(cur, el.dataset.bind, el.value);
    if (el.dataset.bind === 'description') { cur.descEdited = true; }
    saveSoon();
    refreshDerived();
  } else if (el.dataset.set) {
    const k = el.dataset.set;
    settings[k] = el.type === 'checkbox' ? el.checked : NUM_SETTINGS.includes(k) ? (num(el.value) ?? DEFAULTS[k]) : el.value.trim();
    storeSettings(settings);
  } else if (el.dataset.act === 'scale') {
    settings.grassScale = parseFloat(el.value);
    storeSettings(settings);
    clearTimeout(el._t);
    el._t = setTimeout(regrass, 250);
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const act = el.dataset.act;
  if (act === 'addphotos') { await addPhotos(el.files); el.value = ''; }
  if (act === 'usecover') { cur.useCover = el.checked; saveSoon(); }
  if (act === 'msgitem') renderMessages($('#view'), el.value);
  if (el.dataset.set && el.type === 'checkbox') { settings[el.dataset.set] = el.checked; storeSettings(settings); }
});

document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) return go(tabBtn.dataset.tab);
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const act = el.dataset.act;

  if (act === 'mv') {
    const i = +el.dataset.i, j = i + +el.dataset.d;
    if (j < 0 || j >= cur.photos.length) return;
    [cur.photos[i], cur.photos[j]] = [cur.photos[j], cur.photos[i]];
    if (i === 0 || j === 0) { cur.cover = null; cur.cutout = null; renderCover(); }
    saveSoon(); renderPhotos();
  } else if (act === 'rm') {
    const i = +el.dataset.i;
    cur.photos.splice(i, 1);
    if (i === 0) { cur.cover = null; cur.cutout = null; renderCover(); }
    saveSoon(); renderPhotos(); refreshDerived();
  } else if (act === 'cutout') runCutout();
  else if (act === 'regrass') regrass();
  else if (act === 'ai') runAI();
  else if (act === 'rebuild') {
    cur.descEdited = false;
    cur.description = buildDescription(cur);
    $('#desc').value = cur.description;
    saveSoon(); refreshDerived();
  } else if (act === 'userec') {
    cur.price.final = String(priceCalc(cur).rec);
    $('[data-bind="price.final"]').value = cur.price.final;
    saveSoon(); refreshDerived();
  } else if (act === 'lote') {
    const r = await ask('Coste por prenda de un lote', [{ name: 'lote', label: 'Precio del lote (€)' }, { name: 'n', label: 'Prendas útiles del lote' }], 'Calcular');
    const lote = num(r?.lote), n = num(r?.n);
    if (lote != null && n) {
      cur.price.coste = (Math.round((lote / n) * 100) / 100).toString();
      $('[data-bind="price.coste"]').value = cur.price.coste;
      saveSoon(); refreshDerived();
    }
  } else if (act === 'share') sharePhotos();
  else if (act === 'download') downloadPhotos();
  else if (act === 'copy') copy(cur[el.dataset.what], el.dataset.what === 'title' ? 'Título copiado' : 'Descripción copiada');
  else if (act === 'copyval') copy(el.dataset.v);
  else if (act === 'publish') {
    if (cur.status === 'borrador') { cur.status = 'publicado'; cur.publishedAt = Date.now(); }
    await saveItem(cur);
    toast(cur.status === 'publicado' ? '✓ Guardada en "En venta"' : '✓ Guardado');
    filter = cur.status;
    cur = null;
    go('prendas');
  } else if (act === 'savedraft') {
    await saveItem(cur);
    toast('✓ Borrador guardado');
    cur = null; filter = 'borrador';
    go('prendas');
  } else if (act === 'delete') {
    if (!confirm('¿Eliminar esta prenda y sus fotos?')) return;
    await deleteItem(cur.id);
    cur = null;
    go('prendas');
  } else if (act === 'new') {
    if (cur?.photos.length) await saveItem(cur);
    cur = newItem();
    render();
  } else if (act === 'filter') {
    filter = el.dataset.f;
    render();
  } else if (act === 'open') {
    const it = await getItem(el.dataset.id);
    if (it.status === 'publicado') return openPublished(it);
    cur = it;
    go('nueva');
  } else if (act === 'csv') exportCSV();
  else if (act === 'testkey') testKey();
  else if (act === 'install') { installEvt?.prompt(); installEvt = null; el.hidden = true; }
});

async function openPublished(it) {
  const dlg = $('#modal'), form = $('#modalForm');
  form.innerHTML = `<h2 style="margin-top:0">${esc((it.title || 'Prenda').slice(0, 60))}</h2>
    <p class="muted">Publicada hace ${daysSince(it.publishedAt)} días · ${esc(it.price.final)} €</p>
    <div class="btns" style="flex-direction:column">
      <button class="btn primary" value="sold">💰 Marcar como vendida</button>
      <button class="btn" value="edit">✏️ Editar anuncio</button>
      <button class="btn" value="draft">↩️ Volver a borrador</button>
      <button class="btn" value="cancel">Cerrar</button>
    </div>`;
  dlg.showModal();
  dlg.onclose = async () => {
    const r = dlg.returnValue;
    if (r === 'edit') { cur = it; go('nueva'); }
    if (r === 'draft') { it.status = 'borrador'; it.publishedAt = null; await saveItem(it); filter = 'borrador'; render(); }
    if (r === 'sold') {
      const v = await ask('Venta', [
        { name: 'price', label: 'Precio de venta (€)', value: it.price.final },
        { name: 'ship', label: 'Envío que pagas tú (€, 0 si lo paga el comprador)', value: settings.shipAssumed ? settings.shipCost : 0 },
      ]);
      if (!v) return;
      it.status = 'vendido'; it.soldAt = Date.now(); it.soldPrice = num(v.price); it.soldShip = num(v.ship) || 0;
      await saveItem(it);
      toast(`✓ Vendida. Beneficio: ${eur(profit(it))}`, 3500);
      filter = 'vendido';
      render();
    }
  };
}

async function testKey() {
  const st = $('#keystatus');
  st.innerHTML = '<p class="muted"><span class="spin"></span> Comprobando...</p>';
  try {
    const models = await listModels(settings.apiKey);
    $('#models').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
    const ok = models.includes(settings.model);
    st.innerHTML = `<div class="alert ${ok ? 'ok' : ''}">${ok ? `✓ Clave correcta. Modelo "${esc(settings.model)}" disponible.` : `La clave funciona, pero "${esc(settings.model)}" no está en tu lista. Elige uno de: ${esc(models.filter((m) => /flash/.test(m)).slice(0, 6).join(', '))}`}</div>`;
  } catch (e) {
    st.innerHTML = `<div class="alert">${esc(e.message)}</div>`;
  }
}

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

startAppleEmoji();

// Si no hay clave, abre los ajustes la primera vez.
if (!settings.apiKey) { tab = 'ajustes'; $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab)); }
render();
