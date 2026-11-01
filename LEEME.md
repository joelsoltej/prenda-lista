# Prenda Lista

Web app para el móvil que prepara anuncios de Vinted siguiendo la guía de Shark Vintage x BZR Resell.

## Qué hace

1. **Fotos**: subes la principal, las de detalle y la del metro (cámara o galería). Se reducen para que no pesen.
2. **Fondo de césped**: recorta la prenda en el propio móvil y la pone sobre césped artificial con sombra. Se puede poner solo en la portada, en todas las fotos o elegir foto a foto con el 🌱. Las fotos sin fondo, como los primeros planos, se quedan como están. Conviene dejar alguna foto real para que se vea el estado.
3. **IA (Gemini)**: título en inglés con SEO empezando por "Vintage", frase de descripción, hashtags, marca, talla, categoría, colores, material, estado de Vinted y nota /10, defectos, medidas leídas del metro y franja de precio. Lo que no se ve en las fotos sale como `[COMPLETAR]`.
4. **Descripción** con la plantilla de la guía (✅ 👉 📐 📏 ❌ 🚚 🚀 + hashtags), usando tu línea de envío y tu descuento por lote de Ajustes.
5. **Precio**: mínimo = coste + embalaje (+ envío si lo pagas tú) + margen; salida = mínimo + colchón; ajustado a la franja de mercado sin pasarse.
6. **Subir a Vinted**: comparte las fotos con el menú del móvil (cada una con césped si lo tiene activado), copia título y descripción, y copia cada campo de la ficha.
7. **Prendas**: borradores, en venta (con avisos de "destácala 3 días", "baja poco a poco" y "métela en un lote") y vendidas.
8. **Registro**: beneficio total y del mes, ingresos, invertido, stock parado y exportación a CSV.
9. **Mensajes**: los de la guía (likes con oferta de 2 € menos, contraoferta, lote, envío, gracias).

## Por qué no publica sola en Vinted

Vinted no tiene una API pública para crear anuncios, y automatizar la web va contra sus condiciones y puede costarte la cuenta (la guía lo avisa: "Errores y normas"). Por eso la app lo deja todo listo para pegar.

## Clave de Gemini

En https://aistudio.google.com/apikey creas una clave gratis y la pegas en Ajustes. Se guarda solo en el móvil. Pulsa "Probar clave" para ver los modelos disponibles.

## Archivos

- `index.html`, `style.css`, `app.js`: interfaz.
- `js/db.js`: prendas en IndexedDB y ajustes.
- `js/images.js`: recorte (`@imgly/background-removal`, licencia AGPL, uso personal) y montaje sobre el césped.
- `img/grass-*.jpg`: texturas de césped creadas a partir de una foto real.
- `js/ai.js`: llamada a Gemini y las instrucciones de la Gem de la guía.
- `sw.js`, `manifest.webmanifest`, `icons/`: instalación y funcionamiento sin conexión.

## Probar en el ordenador

```
python -m http.server 8765 --directory vinted-app
```

y abre http://localhost:8765. En el móvil necesita estar en una web con HTTPS (por ejemplo GitHub Pages).

Los datos (prendas y fotos) se guardan en el navegador del móvil. Si borras los datos del navegador o desinstalas la app, se pierden.
