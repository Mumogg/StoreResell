#!/usr/bin/env node
// Genera el sitio estático en /dist a partir de data/, productos/ y plantillas/.
// Uso: node scripts/build-site.mjs        (BASE_PATH=/StoreResell por defecto; BASE_PATH= para servir en la raíz)
import { rmSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { ruta, leerJSON, escribirJSON, listarProductos, escribirIndiceProductos, cadenaAleatoria } from './lib.mjs';

// ---------- configuración ----------
const cfg = leerJSON('data/config.json', {});
if (!cfg.panel_slug) {
  // Se genera una sola vez y no vuelve a cambiar.
  cfg.panel_slug = `panel-${cadenaAleatoria(20)}`;
  cfg.sitio_url ??= 'https://mumogg.github.io/StoreResell';
  escribirJSON('data/config.json', cfg);
}
const sitio = new URL(cfg.sitio_url);
const BASE = (process.env.BASE_PATH ?? sitio.pathname).replace(/\/+$/, '');
const abs = (camino) => `${sitio.origin}${BASE}${camino}`;
const TIENDA = cfg.nombre_tienda || 'StoreResell';
const LEMA = cfg.lema || 'Practical digital tools, ready to download';
const ANIO = new Date().getFullYear();

const DIST = ruta('dist');
rmSync(DIST, { recursive: true, force: true });

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const precio = (centavos) => `$${centavos % 100 === 0 ? centavos / 100 : (centavos / 100).toFixed(2)}`;
const plantilla = (nombre) => readFileSync(ruta('plantillas', nombre), 'utf8');
const rellenar = (texto, vars) => texto.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

function escribir(rel, contenido) {
  const destino = join(DIST, rel);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido);
}
function copiar(origen, rel) {
  const destino = join(DIST, rel);
  mkdirSync(dirname(destino), { recursive: true });
  copyFileSync(origen, destino);
}
function tamano(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Markdown básico → HTML (títulos, listas, negrita, cursiva, código, enlaces, párrafos). */
function markdown(md) {
  const enLinea = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  const salida = [];
  let lista = null;
  let parrafo = [];
  const cerrarParrafo = () => { if (parrafo.length) { salida.push(`<p>${parrafo.join(' ')}</p>`); parrafo = []; } };
  const cerrarLista = () => { if (lista) { salida.push(`</${lista}>`); lista = null; } };
  for (const linea of String(md ?? '').replace(/\r/g, '').split('\n')) {
    const l = linea.trim();
    let m;
    if (!l) { cerrarParrafo(); cerrarLista(); continue; }
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
      cerrarParrafo(); cerrarLista();
      const n = Math.min(m[1].length + 1, 4); // "#" → h2: el h1 es el nombre del producto
      salida.push(`<h${n}>${enLinea(m[2])}</h${n}>`);
    } else if ((m = l.match(/^[-*+]\s+(.*)$/)) || (m = l.match(/^\d+[.)]\s+(.*)$/))) {
      cerrarParrafo();
      const tipo = /^\d/.test(l) ? 'ol' : 'ul';
      if (lista !== tipo) { cerrarLista(); salida.push(`<${tipo}>`); lista = tipo; }
      salida.push(`<li>${enLinea(m[1])}</li>`);
    } else if (/^(-{3,}|\*{3,})$/.test(l)) {
      cerrarParrafo(); cerrarLista(); salida.push('<hr>');
    } else {
      cerrarLista(); parrafo.push(enLinea(l));
    }
  }
  cerrarParrafo(); cerrarLista();
  return salida.join('\n');
}

const base = plantilla('base.html');
function pagina({ titulo, descripcion, contenido, meta = '', clase = '', scripts = '' }) {
  return rellenar(base, {
    titulo: esc(titulo), descripcion: esc(descripcion), contenido, meta, clase, scripts,
    base: BASE, tienda: esc(TIENDA), anio: ANIO,
  });
}

// ---------- datos ----------
const productos = listarProductos().filter((p) => p.ficha);
const visibles = productos.filter(({ ficha: f }) => !f.prueba && ['en_venta', 'construido'].includes(f.estado));
const comprable = (f) => f.estado === 'en_venta' && f.checkout_url;

function botonCompra(f, clase = 'boton') {
  return comprable(f)
    ? `<a class="${clase}" href="${esc(f.checkout_url)}" rel="noopener">Buy · ${precio(f.precio_usd_centavos)}</a>`
    : `<span class="${clase} boton--pronto" aria-disabled="true">Coming soon</span>`;
}

// ---------- recursos ----------
copiar(ruta('plantillas', 'estilos.css'), 'assets/estilos.css');
copiar(ruta('plantillas', 'tienda.js'), 'assets/tienda.js');
copiar(ruta('plantillas', 'panel.css'), 'assets/panel.css');
copiar(ruta('plantillas', 'panel.js'), 'assets/panel.js');
escribir('.nojekyll', '');

// ---------- portada de la tienda ----------
const categorias = [...new Set(visibles.map((p) => p.ficha.categoria))].sort();
const filtros = categorias.length > 1
  ? `<div class="filtros" role="group" aria-label="Filter by category">
      <button class="filtro activo" data-cat="" type="button">All</button>
      ${categorias.map((c) => `<button class="filtro" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join('\n      ')}
    </div>` : '';
const tarjetas = visibles
  .sort((a, b) => b.ficha.fecha_creacion.localeCompare(a.ficha.fecha_creacion))
  .map(({ ficha: f }) => `<article class="tarjeta" data-cat="${esc(f.categoria)}">
      <a class="tarjeta__img" href="${BASE}/p/${f.slug}/" tabindex="-1" aria-hidden="true"><img src="${BASE}/p/${f.slug}/${esc(f.portada)}" alt="" width="1200" height="900" loading="lazy"></a>
      <div class="tarjeta__cuerpo">
        <span class="etiqueta">${esc(f.categoria)}</span>
        <h2 class="tarjeta__titulo"><a href="${BASE}/p/${f.slug}/">${esc(f.nombre)}</a></h2>
        <p class="tarjeta__sub">${esc(f.subtitulo)}</p>
        <div class="tarjeta__pie">
          <span class="precio">${precio(f.precio_usd_centavos)}</span>
          ${comprable(f) ? `<a class="boton boton--chico" href="${esc(f.checkout_url)}" rel="noopener">Buy</a>` : '<span class="boton boton--chico boton--pronto">Coming soon</span>'}
        </div>
      </div>
    </article>`).join('\n');

escribir('index.html', pagina({
  titulo: `${TIENDA} — ${LEMA}`,
  descripcion: `${LEMA}. Templates, guides and packs you can use today. Instant download after purchase.`,
  meta: `<link rel="canonical" href="${abs('/')}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(TIENDA)}">
<meta property="og:description" content="${esc(LEMA)}">
<meta property="og:url" content="${abs('/')}">`,
  scripts: `<script src="${BASE}/assets/tienda.js" defer></script>`,
  contenido: `<section class="hero">
    <p class="hero__sobre">Digital downloads</p>
    <h1>Useful tools you can put to work <em>today</em>.</h1>
    <p class="hero__texto">Templates, guides and packs built to solve one problem well. Pay once, download instantly, keep it forever.</p>
  </section>
  <section class="catalogo" id="products">
    ${filtros}
    ${visibles.length ? `<div class="cuadricula">${tarjetas}</div>` : `<div class="vacio"><h2>New products are on the way</h2><p>The first releases are being built right now. Check back soon.</p></div>`}
  </section>`,
}));

// ---------- páginas de producto y de descarga ----------
for (const { carpeta, ficha: f } of productos) {
  const origen = ruta('productos', carpeta);
  const publico = f.estado !== 'pausado';

  if (publico) {
    copiar(join(origen, f.portada), `p/${f.slug}/${f.portada}`);
    const urlP = abs(`/p/${f.slug}/`);
    const img = abs(`/p/${f.slug}/${f.portada}`);
    escribir(`p/${f.slug}/index.html`, pagina({
      titulo: `${f.nombre} — ${TIENDA}`,
      descripcion: f.descripcion_corta,
      meta: `${f.prueba ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${urlP}">`}
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(f.nombre)}">
<meta property="og:description" content="${esc(f.descripcion_corta)}">
<meta property="og:url" content="${urlP}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="900">
<meta property="product:price:amount" content="${(f.precio_usd_centavos / 100).toFixed(2)}">
<meta property="product:price:currency" content="USD">
<meta name="twitter:card" content="summary_large_image">`,
      contenido: `${f.prueba ? '<p class="aviso">Test product — not listed in the store.</p>' : ''}
  <article class="producto" lang="${esc(f.idioma)}">
    <div class="producto__img"><img src="${BASE}/p/${f.slug}/${esc(f.portada)}" alt="${esc(f.nombre)} cover" width="1200" height="900"></div>
    <div class="producto__info">
      <span class="etiqueta">${esc(f.categoria)}</span>
      <h1>${esc(f.nombre)}</h1>
      <p class="producto__sub">${esc(f.subtitulo)}</p>
      <div class="compra">
        <span class="precio precio--grande">${precio(f.precio_usd_centavos)}</span>
        ${botonCompra(f, 'boton boton--grande')}
        <p class="compra__nota">One-time payment · Instant download · Secure checkout</p>
      </div>
      <h2 class="incluye__titulo">What's included</h2>
      <ul class="incluye">${f.incluye.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>
    <div class="producto__desc prosa">${markdown(f.descripcion_larga_md)}</div>
  </article>
  <p class="volver"><a href="${BASE}/">← All products</a></p>`,
    }));
  }

  // La página de descarga existe siempre (también si el producto se pausa: quien compró conserva su enlace).
  const enlaces = f.archivos.map((a) => {
    const nombre = basename(a);
    const src = join(origen, a);
    copiar(src, `d/${f.token_descarga}/${nombre}`);
    const ext = nombre.includes('.') ? nombre.split('.').pop().toUpperCase() : 'FILE';
    return `<li><a class="descarga" href="${encodeURIComponent(nombre)}" download>
        <span class="descarga__ext">${esc(ext)}</span>
        <span class="descarga__nombre">${esc(nombre)}</span>
        <span class="descarga__peso">${tamano(readFileSync(src).length)}</span>
      </a></li>`;
  }).join('\n');
  escribir(`d/${f.token_descarga}/index.html`, pagina({
    titulo: `Your download — ${f.nombre}`,
    descripcion: 'Your files are ready.',
    meta: '<meta name="robots" content="noindex, nofollow, noarchive">\n<meta name="referrer" content="no-referrer">',
    clase: 'pagina-descarga',
    contenido: `<section class="gracias">
    <p class="hero__sobre">Order confirmed</p>
    <h1>Thank you!</h1>
    <p class="hero__texto">Your copy of <strong>${esc(f.nombre)}</strong> is ready. Download your files below and bookmark this page — it is your permanent download link.</p>
    <ul class="descargas">${enlaces}</ul>
    <p class="compra__nota">A receipt with this link was also sent to your email.</p>
  </section>`,
  }));
}

// ---------- panel de control ----------
escribir(`${cfg.panel_slug}/index.html`, rellenar(plantilla('panel.html'), { base: BASE, tienda: esc(TIENDA) }));
escribirIndiceProductos();
for (const nombre of ['agentes', 'oportunidades', 'productos', 'ventas', 'actividad']) {
  copiar(ruta('data', `${nombre}.json`), `data/${nombre}.json`);
}

// ---------- 404, robots y sitemap ----------
escribir('404.html', pagina({
  titulo: `Page not found — ${TIENDA}`,
  descripcion: 'Page not found.',
  meta: '<meta name="robots" content="noindex">',
  contenido: `<section class="vacio"><h1>Page not found</h1><p>That link doesn't lead anywhere.</p><p><a class="boton" href="${BASE}/">Browse the store</a></p></section>`,
}));
escribir('robots.txt', `User-agent: *
Disallow: ${BASE}/d/
Disallow: ${BASE}/panel-
Disallow: ${BASE}/data/

Sitemap: ${abs('/sitemap.xml')}
`);
const urls = [abs('/'), ...visibles.map((p) => abs(`/p/${p.ficha.slug}/`))];
escribir('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`);

console.log(`✓ Sitio generado en dist/ (base "${BASE || '/'}")`);
console.log(`  Tienda: ${visibles.length} producto(s) visibles · ${productos.length} en total`);
console.log(`  Panel:  ${abs(`/${cfg.panel_slug}/`)}`);
