// Sustituye los emojis de la interfaz por las imágenes de Apple (emoji-datasource-apple).
// Los textos que se copian a Vinted siguen siendo emojis normales: cada comprador los ve con los de su móvil.

const CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/';
// Solo emojis que se muestran como dibujo: los de presentación emoji o los que llevan FE0F.
// Así símbolos de texto como ◀ ▶ se quedan como texto.
const PIC = String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)\p{Emoji_Modifier}?`;
const RE = new RegExp(String.raw`\p{Regional_Indicator}{2}|[#*0-9]️⃣|${PIC}(?:‍(?:${PIC}|\p{Extended_Pictographic}))*`, 'gu');
const SKIP = new Set(['TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'TITLE']);

const code = (s) => [...s].map((c) => c.codePointAt(0).toString(16)).join('-');

function img(ch) {
  const el = document.createElement('img');
  el.className = 'emo';
  el.alt = ch;
  el.draggable = false;
  el.decoding = 'async';
  const full = code(ch);
  el.src = CDN + full + '.png';
  // Algunos archivos llevan el selector de variante (fe0f) y otros no: se prueba la otra forma y, si no, se deja el texto.
  el.onerror = () => {
    const alt = full.includes('-fe0f') ? full.replace(/-fe0f/g, '') : null;
    if (alt && !el.dataset.retry) { el.dataset.retry = 1; el.src = CDN + alt + '.png'; }
    else el.replaceWith(document.createTextNode(ch));
  };
  return el;
}

function convertText(node) {
  const text = node.nodeValue;
  RE.lastIndex = 0;
  if (!RE.test(text)) return;
  RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(RE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(img(m[0]));
    last = m.index + m[0].length;
  }
  if (last === 0) return;
  if (last < text.length) frag.append(text.slice(last));
  node.replaceWith(frag);
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!SKIP.has(root.parentNode?.nodeName)) convertText(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.nodeName)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (SKIP.has(n.parentNode.nodeName) || n.parentNode.closest?.('textarea,select') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (tw.nextNode()) nodes.push(tw.currentNode);
  nodes.forEach(convertText);
}

export function startAppleEmoji(root = document.body) {
  walk(root);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') walk(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
