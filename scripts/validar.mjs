#!/usr/bin/env node
// Valida todos los JSON del repositorio. Lo usan los agentes antes de cada commit y la CI.
// Uso: node scripts/validar.mjs
import { existsSync, statSync } from 'node:fs';
import { leerJSON, listarProductos, ruta, AGENTES, MAX_ACTIVIDAD } from './lib.mjs';

const errores = [];
const err = (donde, msg) => errores.push(`✗ ${donde}: ${msg}`);

const esTexto = (v) => typeof v === 'string' && v.trim().length > 0;
const esEntero = (v) => Number.isInteger(v);
const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const esISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const esURL = (v) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
const esSlug = (v) => typeof v === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);

function cargar(rel) {
  try {
    return leerJSON(rel);
  } catch (e) {
    err(rel, `no se pudo leer (${e.message})`);
    return null;
  }
}

// ---------- data/agentes.json ----------
const ESTADOS_AGENTE = ['esperando', 'trabajando', 'ok', 'error'];
const agentes = cargar('data/agentes.json');
if (agentes) {
  if (!Array.isArray(agentes)) err('data/agentes.json', 'debe ser un arreglo');
  else {
    for (const id of AGENTES) {
      if (!agentes.some((a) => a?.id === id)) err('data/agentes.json', `falta el agente "${id}"`);
    }
    agentes.forEach((a, i) => {
      const d = `data/agentes.json[${i}] (${a?.id ?? '?'})`;
      if (!AGENTES.includes(a?.id)) err(d, `"id" debe ser uno de: ${AGENTES.join(', ')}`);
      for (const k of ['nombre', 'rol', 'horario']) if (!esTexto(a?.[k])) err(d, `"${k}" debe ser texto no vacío`);
      if (!ESTADOS_AGENTE.includes(a?.estado)) err(d, `"estado" debe ser uno de: ${ESTADOS_AGENTE.join(', ')}`);
      if (a?.ultima_ejecucion !== null && !esISO(a?.ultima_ejecucion)) err(d, '"ultima_ejecucion" debe ser null o fecha ISO 8601');
      if (typeof a?.ultimo_resultado !== 'string') err(d, '"ultimo_resultado" debe ser texto (puede estar vacío)');
    });
  }
}

// ---------- data/oportunidades.json ----------
const TIPOS = ['pdf', 'plantilla', 'pack', 'guia', 'hoja-calculo', 'otro'];
const ESTADOS_OP = ['detectada', 'en_construccion', 'construida', 'en_venta', 'descartada'];
const oportunidades = cargar('data/oportunidades.json');
const idsOportunidad = new Set();
if (oportunidades) {
  if (!Array.isArray(oportunidades)) err('data/oportunidades.json', 'debe ser un arreglo');
  else {
    oportunidades.forEach((o, i) => {
      const d = `data/oportunidades.json[${i}] (${o?.id ?? '?'})`;
      if (!esTexto(o?.id)) err(d, '"id" debe ser texto, p. ej. "2026-11-16-ia-01"');
      else if (idsOportunidad.has(o.id)) err(d, `"id" duplicado: ${o.id}`);
      else idsOportunidad.add(o.id);
      if (!esFecha(o?.fecha)) err(d, '"fecha" debe tener formato AAAA-MM-DD');
      if (!['radar-ia-saas', 'radar-ecommerce'].includes(o?.agente)) err(d, '"agente" debe ser "radar-ia-saas" o "radar-ecommerce"');
      for (const k of ['nombre', 'resumen', 'por_que_ahora', 'cliente_ideal']) if (!esTexto(o?.[k])) err(d, `"${k}" debe ser texto no vacío`);
      if (!Array.isArray(o?.fuentes) || !o.fuentes.every(esURL)) err(d, '"fuentes" debe ser un arreglo de URLs http(s)');
      if (!TIPOS.includes(o?.tipo_producto)) err(d, `"tipo_producto" debe ser uno de: ${TIPOS.join(', ')}`);
      if (!esNumero(o?.precio_sugerido_usd) || o.precio_sugerido_usd <= 0) err(d, '"precio_sugerido_usd" debe ser un número mayor que 0');
      const p = o?.puntuacion;
      const claves = ['facilidad', 'ingresos', 'rapidez'];
      if (!p || !claves.every((k) => esEntero(p[k]) && p[k] >= 0 && p[k] <= 10)) {
        err(d, '"puntuacion" necesita facilidad, ingresos y rapidez como enteros de 0 a 10');
      } else if (o.total !== p.facilidad + p.ingresos + p.rapidez) {
        err(d, `"total" debe ser la suma de la puntuación (${p.facilidad + p.ingresos + p.rapidez}), no ${o.total}`);
      }
      if (!ESTADOS_OP.includes(o?.estado)) err(d, `"estado" debe ser uno de: ${ESTADOS_OP.join(', ')}`);
      if (o?.producto_slug !== null && !esSlug(o?.producto_slug)) err(d, '"producto_slug" debe ser null o un slug válido');
      if (['construida', 'en_venta'].includes(o?.estado) && !o?.producto_slug) err(d, `con estado "${o.estado}" hace falta "producto_slug"`);
      if (o?.producto_slug && !existsSync(ruta('productos', o.producto_slug, 'producto.json'))) err(d, `"producto_slug" apunta a un producto que no existe: productos/${o.producto_slug}/`);
      if (o?.motivo_descarte !== null && !esTexto(o?.motivo_descarte)) err(d, '"motivo_descarte" debe ser null o texto');
      if (o?.estado === 'descartada' && !esTexto(o?.motivo_descarte)) err(d, 'una oportunidad "descartada" necesita "motivo_descarte"');
    });
  }
}

// ---------- productos/<slug>/producto.json ----------
const ESTADOS_PROD = ['construido', 'en_venta', 'pausado'];
const tokens = new Map();
let productos = [];
try {
  productos = listarProductos();
} catch (e) {
  err('productos/', `no se pudo leer un producto.json (${e.message})`);
}
for (const { carpeta, rel, ficha: f } of productos) {
  if (!f) { err(`productos/${carpeta}/`, 'falta producto.json'); continue; }
  if (!esSlug(f.slug)) err(rel, '"slug" debe ser minúsculas, números y guiones');
  if (f.slug !== carpeta) err(rel, `"slug" (${f.slug}) debe coincidir con el nombre de la carpeta (${carpeta})`);
  if (f.oportunidad_id !== null && !esTexto(f.oportunidad_id)) err(rel, '"oportunidad_id" debe ser texto o null');
  else if (f.oportunidad_id && oportunidades && !idsOportunidad.has(f.oportunidad_id)) err(rel, `"oportunidad_id" no existe en data/oportunidades.json: ${f.oportunidad_id}`);
  for (const k of ['nombre', 'subtitulo', 'descripcion_corta', 'descripcion_larga_md', 'categoria', 'creado_por']) {
    if (!esTexto(f[k])) err(rel, `"${k}" debe ser texto no vacío`);
  }
  if (esTexto(f.descripcion_corta) && f.descripcion_corta.length > 160) err(rel, `"descripcion_corta" tiene ${f.descripcion_corta.length} caracteres (máx. 160)`);
  if (!Array.isArray(f.incluye) || f.incluye.length === 0 || !f.incluye.every(esTexto)) err(rel, '"incluye" debe ser un arreglo de textos con al menos un elemento');
  if (!esEntero(f.precio_usd_centavos) || f.precio_usd_centavos < 50) err(rel, '"precio_usd_centavos" debe ser un entero en centavos (mínimo 50)');
  if (!/^[a-z]{2}$/.test(f.idioma ?? '')) err(rel, '"idioma" debe ser un código de 2 letras, p. ej. "en"');
  if (!esTexto(f.portada)) err(rel, '"portada" debe ser el nombre del archivo de portada');
  else if (!existsSync(ruta('productos', carpeta, f.portada))) err(rel, `no existe la portada productos/${carpeta}/${f.portada}`);
  if (!Array.isArray(f.archivos) || f.archivos.length === 0) err(rel, '"archivos" debe listar al menos un archivo');
  else {
    const nombres = new Set();
    for (const a of f.archivos) {
      if (!esTexto(a) || !a.startsWith('archivos/') || a.includes('..')) { err(rel, `archivo inválido "${a}": debe estar dentro de archivos/`); continue; }
      const abs = ruta('productos', carpeta, a);
      if (!existsSync(abs) || !statSync(abs).isFile()) err(rel, `no existe el archivo productos/${carpeta}/${a}`);
      const nombre = a.split('/').pop();
      if (nombres.has(nombre)) err(rel, `dos archivos comparten el mismo nombre: ${nombre}`);
      nombres.add(nombre);
    }
  }
  if (!/^[a-z0-9]{32}$/.test(f.token_descarga ?? '')) err(rel, '"token_descarga" debe tener exactamente 32 caracteres [a-z0-9]');
  else if (tokens.has(f.token_descarga)) err(rel, `"token_descarga" repetido (también en ${tokens.get(f.token_descarga)})`);
  else tokens.set(f.token_descarga, rel);
  if (!ESTADOS_PROD.includes(f.estado)) err(rel, `"estado" debe ser uno de: ${ESTADOS_PROD.join(', ')}`);
  if (f.checkout_url !== null && !esURL(f.checkout_url)) err(rel, '"checkout_url" debe ser null o una URL');
  if (f.checkout_id !== null && !esTexto(f.checkout_id)) err(rel, '"checkout_id" debe ser null o texto');
  if (f.estado === 'en_venta' && !f.checkout_url) err(rel, 'un producto "en_venta" necesita "checkout_url" (lo pone GitHub Actions; los agentes deben dejar "construido")');
  if (!esFecha(f.fecha_creacion)) err(rel, '"fecha_creacion" debe tener formato AAAA-MM-DD');
  if (typeof f.prueba !== 'boolean') err(rel, '"prueba" debe ser true o false');
}

// ---------- data/actividad.json ----------
const actividad = cargar('data/actividad.json');
if (actividad) {
  if (!Array.isArray(actividad)) err('data/actividad.json', 'debe ser un arreglo');
  else {
    if (actividad.length > MAX_ACTIVIDAD) err('data/actividad.json', `tiene ${actividad.length} eventos (máx. ${MAX_ACTIVIDAD}); borra los más antiguos`);
    actividad.forEach((e, i) => {
      const d = `data/actividad.json[${i}]`;
      if (!esISO(e?.fecha)) err(d, '"fecha" debe ser ISO 8601, p. ej. 2026-11-16T12:00:00Z');
      if (!AGENTES.includes(e?.agente)) err(d, `"agente" debe ser uno de: ${AGENTES.join(', ')}`);
      if (!esTexto(e?.mensaje)) err(d, '"mensaje" debe ser texto no vacío');
      if (e?.enlace !== null && !esTexto(e?.enlace)) err(d, '"enlace" debe ser null o texto');
      if (i > 0 && esISO(e?.fecha) && esISO(actividad[i - 1]?.fecha) && Date.parse(e.fecha) > Date.parse(actividad[i - 1].fecha)) {
        err(d, 'los eventos deben ir del más reciente al más antiguo (los nuevos se agregan al inicio)');
      }
    });
  }
}

// ---------- data/ventas.json ----------
const ventas = cargar('data/ventas.json');
if (ventas) {
  const d = 'data/ventas.json';
  const esBloque = (b, claves) => b && typeof b === 'object' && claves.every((k) => esNumero(b[k]) && b[k] >= 0);
  if (ventas.actualizado !== null && !esISO(ventas.actualizado)) err(d, '"actualizado" debe ser null o fecha ISO 8601');
  if (typeof ventas.modo_prueba !== 'boolean') err(d, '"modo_prueba" debe ser true o false');
  if (!esBloque(ventas.totales, ['pedidos', 'ingresos_usd', 'reembolsos'])) err(d, '"totales" necesita pedidos, ingresos_usd y reembolsos numéricos');
  if (!ventas.por_producto || typeof ventas.por_producto !== 'object' || Array.isArray(ventas.por_producto)) err(d, '"por_producto" debe ser un objeto');
  else for (const [slug, b] of Object.entries(ventas.por_producto)) if (!esBloque(b, ['pedidos', 'ingresos_usd'])) err(d, `por_producto["${slug}"] necesita pedidos e ingresos_usd numéricos`);
  if (!esBloque(ventas.sin_asignar, ['pedidos', 'ingresos_usd'])) err(d, '"sin_asignar" necesita pedidos e ingresos_usd numéricos');
  if (!Array.isArray(ventas.ultimos_pedidos)) err(d, '"ultimos_pedidos" debe ser un arreglo');
  else ventas.ultimos_pedidos.forEach((p, i) => {
    if (!esISO(p?.fecha) || typeof p?.slug !== 'string' || !esNumero(p?.total_usd) || typeof p?.pais !== 'string' || typeof p?.estado !== 'string') {
      err(`${d} ultimos_pedidos[${i}]`, 'necesita fecha (ISO), slug, total_usd, pais y estado');
    }
  });
  // El repositorio es público: nunca debe haber datos personales de compradores.
  if (/"(email|user_email|user_name|nombre_cliente|customer_name)"|[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(JSON.stringify(ventas))) {
    err(d, 'parece contener datos personales (emails o nombres de compradores); el repo es público');
  }
}

// ---------- data/config.json ----------
const cfg = cargar('data/config.json');
if (cfg) {
  if (!/^panel-[a-z0-9]{12,}$/.test(cfg.panel_slug ?? '')) err('data/config.json', '"panel_slug" debe ser "panel-" + cadena aleatoria; no lo cambies');
  if (!esURL(cfg.sitio_url)) err('data/config.json', '"sitio_url" debe ser la URL pública del sitio');
}

if (errores.length) {
  console.error(`Validación fallida: ${errores.length} problema(s)\n`);
  for (const e of errores) console.error(e);
  console.error('\nCorrige lo anterior y vuelve a ejecutar: node scripts/validar.mjs');
  process.exit(1);
}
console.log(`✓ Todo válido: ${agentes.length} agentes, ${oportunidades.length} oportunidades, ${productos.length} productos, ${actividad.length} eventos.`);
