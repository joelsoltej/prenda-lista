// Análisis de la prenda con Gemini. Las instrucciones son las de la Gem "Vinted Titles" de la guía,
// adaptadas para que la respuesta llegue como datos y la app monte la descripción con tus ajustes.

import { resize, toBase64 } from './images.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export const ESTADOS = ['Nuevo con etiquetas', 'Nuevo sin etiquetas', 'Muy bueno', 'Bueno', 'Satisfactorio'];

const S = (description) => ({ type: 'STRING', description });
const N = (description) => ({ type: 'NUMBER', description });
const LIST = (description) => ({ type: 'ARRAY', items: { type: 'STRING' }, description });

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    titulo: S('Título en inglés, largo, SEO, empieza por "Vintage"'),
    descripcion_prenda: S('En español: tipo, color, detalles, logo, estilo y uso ideal. 1-3 frases, sin emoji inicial'),
    hashtags: LIST('15-25 hashtags sin # ni espacios, relacionados con la prenda'),
    marca: S('Marca visible o [COMPLETAR]'),
    talla: S('Talla de la etiqueta o [COMPLETAR]'),
    tipo_prenda: S('p. ej. Chaqueta deportiva'),
    categoria_vinted: S('Ruta de categoría de Vinted España, p. ej. Hombre > Ropa > Abrigos y chaquetas > Chaquetas'),
    colores: LIST('1 o 2 colores principales en español, como en Vinted'),
    material: S('Composición de la etiqueta o [COMPLETAR]'),
    pais_fabricacion: S('País de la etiqueta o [COMPLETAR]'),
    estado_vinted: { type: 'STRING', enum: ESTADOS },
    estado_nota: N('Nota de 1 a 10 para la línea "Estado X/10"'),
    estado_motivo: S('Por qué ese estado, en una frase'),
    defectos: LIST('Defectos visibles (manchas, rotos, descosidos, bolitas, decoloración). Vacío si no se ven'),
    medidas: {
      type: 'ARRAY',
      description: 'Solo medidas que se lean en la foto del metro. Vacío si no hay',
      items: { type: 'OBJECT', properties: { nombre: S('p. ej. Axila a axila'), cm: { type: 'NUMBER' } }, required: ['nombre', 'cm'] },
    },
    precio_min: N('€, franja realista de venta en Vinted España (segunda mano)'),
    precio_max: N('€'),
    precio_recomendado: N('€, precio de salida sugerido'),
    precio_motivo: S('Qué lo justifica: marca, época, estado, demanda'),
    paquete: { type: 'STRING', enum: ['Pequeño', 'Mediano', 'Grande'] },
    avisos: LIST('Cosas que el vendedor debe comprobar con la prenda en la mano'),
  },
  required: ['titulo', 'descripcion_prenda', 'hashtags', 'marca', 'talla', 'tipo_prenda', 'categoria_vinted', 'colores',
    'material', 'pais_fabricacion', 'estado_vinted', 'estado_nota', 'estado_motivo', 'defectos', 'medidas',
    'precio_min', 'precio_max', 'precio_recomendado', 'precio_motivo', 'paquete', 'avisos'],
};

const INSTRUCCIONES = `Eres un escritor profesional de títulos y descripciones para Vinted España y un tasador de ropa de segunda mano.

Recibes fotos de UNA prenda: la primera es la principal; después van detalles (etiqueta, tejido, cuello, costuras, defectos) y, normalmente al final, una foto con un metro para las medidas.

TÍTULO: largo, en inglés, con keywords y SEO optimizado para vender lo máximo posible, adaptado al tipo de prenda. Empieza siempre por "Vintage". Pon lo más importante al principio (Vintage, marca, tipo de prenda) y añade estilo (Y2K, 90s, streetwear, retro, old money...) y color. Usa solo keywords que correspondan de verdad a la prenda. Ejemplos de títulos ganadores:
- Vintage Dressing Leather Jacket Veste En Cuir Genuine Made In Italy Brown Marron L
- Puma Gray Navy Velvet Track Jacket Vintage 90s Y2K Embroidered Logo
- Adidas Yellow Golden track Jacket retro colorblock Streetwear black Stripes aesthetic fit
- Emidio Tucci Trackjacket Y2K Streetwear Premium Retro Style Vintage Limited Edition 80s
- Vintage Ralph Lauren Polo Shirt Premium Old Money Style USA Retro 90' Casual Preppy Classic Tee
"Made in X", "Premium", "Limited Edition" o "Genuine" solo si se ve en la etiqueta o es verdad.

DESCRIPCIÓN: en español, una línea natural que describa tipo, color, detalles, logo, estilo y uso ideal.

HASHTAGS: muchos, relacionados con la prenda.

ESTADO (escala de Vinted): Nuevo con etiquetas (lleva etiquetas puestas), Nuevo sin etiquetas (sin uso), Muy bueno (poco uso, sin defectos), Bueno (uso visible o defectos pequeños), Satisfactorio (defectos claros). Sé honesto: si ves bolitas, decoloración, manchas o rotos, baja el estado y lístalos en defectos.

PRECIO: estima la franja en la que se VENDE de verdad una prenda así en Vinted España (no el precio más alto que se ve publicado). Ten en cuenta marca, época, tipo, estado y tendencia vintage.

REGLAS: no inventes la marca, el país de fabricación, el material ni la talla. Si algo no se ve en las fotos y el vendedor no te lo ha dicho, escribe exactamente [COMPLETAR]. Si el vendedor te da datos o defectos, úsalos y tienen prioridad sobre lo que veas.`;

function friendly(msg, status) {
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) return 'La clave de Gemini no es válida. Revísala en Ajustes.';
  if (status === 429 || /quota|rate/i.test(msg)) return 'Has llegado al límite gratuito de Gemini por ahora. Espera un minuto y vuelve a probar.';
  if (status === 404 || /not found/i.test(msg)) return 'Ese modelo no existe o no está disponible. Pulsa "Probar clave" en Ajustes y elige otro.';
  if (status >= 500 || /overloaded|unavailable/i.test(msg)) return 'Gemini está saturado ahora mismo. Prueba otra vez en unos segundos.';
  return msg || `Error ${status} de Gemini`;
}

export async function analyze(photos, known, settings) {
  if (!settings.apiKey) throw new Error('Falta la clave de Gemini. Ponla en Ajustes.');
  const picks = photos.slice(0, 8);
  const parts = [{ text: INSTRUCCIONES }];
  for (const p of picks) {
    const small = await resize(p, 1024, 0.82);
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toBase64(small) } });
  }
  const datos = [
    known.marca && `Marca: ${known.marca}`,
    known.talla && `Talla: ${known.talla}`,
    known.material && `Material: ${known.material}`,
    known.pais && `País de fabricación: ${known.pais}`,
    known.defectos && `Defectos: ${known.defectos}`,
    known.notas && `Notas: ${known.notas}`,
  ].filter(Boolean);
  parts.push({ text: datos.length ? `Datos que da el vendedor:\n${datos.join('\n')}` : 'El vendedor no ha añadido datos extra.' });

  const res = await fetch(`${API}/models/${encodeURIComponent(settings.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.4 },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(body.error?.message, res.status));
  const text = (body.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text) throw new Error('Gemini no devolvió respuesta (' + (body.candidates?.[0]?.finishReason || 'sin motivo') + ')');
  return JSON.parse(text);
}

// Comprueba la clave y devuelve los modelos con visión que admiten generateContent.
export async function listModels(apiKey) {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(body.error?.message, res.status));
  return (body.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(m.name) && !/image|tts|audio|embedding|live/.test(m.name))
    .map((m) => m.name.replace('models/', ''));
}
