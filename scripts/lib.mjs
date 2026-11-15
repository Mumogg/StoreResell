// Utilidades compartidas por todos los scripts. Sin dependencias: solo Node 20+.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ruta = (...partes) => join(RAIZ, ...partes);

export const AGENTES = ['radar-ia-saas', 'radar-ecommerce', 'constructor', 'github-actions'];
export const MAX_ACTIVIDAD = 200;

export function leerJSON(rel, porDefecto) {
  const archivo = ruta(rel);
  if (!existsSync(archivo)) {
    if (porDefecto !== undefined) return porDefecto;
    throw new Error(`No existe ${rel}`);
  }
  return JSON.parse(readFileSync(archivo, 'utf8'));
}

export function escribirJSON(rel, datos) {
  writeFileSync(ruta(rel), JSON.stringify(datos, null, 2) + '\n');
}

export function cadenaAleatoria(largo) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...randomBytes(largo)].map((b) => abc[b % abc.length]).join('');
}

/** Devuelve [{ carpeta, rel, ficha }] por cada productos/<carpeta>/producto.json. */
export function listarProductos() {
  const base = ruta('productos');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((n) => statSync(join(base, n)).isDirectory())
    .sort()
    .map((carpeta) => {
      const rel = `productos/${carpeta}/producto.json`;
      return { carpeta, rel, ficha: existsSync(ruta(rel)) ? leerJSON(rel) : null };
    });
}

/** Agrega un evento al inicio de data/actividad.json (máx. 200). */
export function registrarActividad(agente, mensaje, enlace = null, { sinRepetir = false } = {}) {
  const actividad = leerJSON('data/actividad.json', []);
  if (sinRepetir) {
    const ultimo = actividad.find((e) => e.agente === agente);
    if (ultimo && ultimo.mensaje === mensaje) return false;
  }
  actividad.unshift({ fecha: new Date().toISOString(), agente, mensaje, enlace });
  escribirJSON('data/actividad.json', actividad.slice(0, MAX_ACTIVIDAD));
  return true;
}

/** Actualiza la entrada de un agente en data/agentes.json. */
export function actualizarAgente(id, cambios) {
  const agentes = leerJSON('data/agentes.json');
  const agente = agentes.find((a) => a.id === id);
  if (!agente) throw new Error(`Agente desconocido: ${id}`);
  Object.assign(agente, cambios);
  escribirJSON('data/agentes.json', agentes);
}

/** Índice público de productos (sin token de descarga). */
export function indiceProductos() {
  return listarProductos()
    .filter((p) => p.ficha)
    .map(({ ficha: f }) => ({
      slug: f.slug,
      oportunidad_id: f.oportunidad_id ?? null,
      nombre: f.nombre,
      subtitulo: f.subtitulo,
      precio_usd_centavos: f.precio_usd_centavos,
      categoria: f.categoria,
      estado: f.estado,
      checkout_url: f.checkout_url ?? null,
      prueba: f.prueba === true,
      fecha_creacion: f.fecha_creacion,
    }));
}

export function escribirIndiceProductos() {
  const nuevo = indiceProductos();
  const actual = leerJSON('data/productos.json', null);
  if (JSON.stringify(actual) !== JSON.stringify(nuevo)) escribirJSON('data/productos.json', nuevo);
  return nuevo;
}

export const modoPrueba = () => String(process.env.LEMONSQUEEZY_TEST_MODE ?? 'true').trim().toLowerCase() !== 'false';

/** URL pública del sitio, sin barra final. */
export function urlSitio() {
  const cfg = leerJSON('data/config.json', {});
  return String(cfg.sitio_url || 'https://mumogg.github.io/StoreResell').replace(/\/+$/, '');
}

// LEMONSQUEEZY_API_URL solo existe para pruebas locales con un servidor simulado.
const API = process.env.LEMONSQUEEZY_API_URL || 'https://api.lemonsqueezy.com/v1';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Llamada a la API de Lemon Squeezy con reintentos ante 429. Nunca imprime la clave. */
export async function lemon(camino, { metodo = 'GET', cuerpo } = {}) {
  const clave = process.env.LEMONSQUEEZY_API_KEY;
  if (!clave) throw new Error('Falta LEMONSQUEEZY_API_KEY');
  const url = camino.startsWith('http') ? camino : `${API}${camino}`;
  for (let intento = 1; ; intento++) {
    const res = await fetch(url, {
      method: metodo,
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${clave}`,
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (res.status === 429 && intento <= 5) {
      const espera = Math.min(Number(res.headers.get('retry-after')) || 2 ** intento, 60);
      console.log(`Límite de peticiones (429). Reintento ${intento}/5 en ${espera} s…`);
      await esperar(espera * 1000);
      continue;
    }
    const texto = await res.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
    if (!res.ok) {
      const detalle = json?.errors?.map((e) => e.detail || e.title).join('; ') || texto.slice(0, 200);
      throw new Error(`Lemon Squeezy ${res.status}: ${detalle}`);
    }
    return json;
  }
}

/**
 * IDs de tienda y variante. Usa las variables si existen; si no, los descubre:
 * primera tienda → producto llamado exactamente "Producto digital" → primera variante.
 */
export async function descubrirIds({ necesitaVariante = true } = {}) {
  let tienda = (process.env.LEMONSQUEEZY_STORE_ID || '').trim();
  let variante = (process.env.LEMONSQUEEZY_VARIANT_ID || '').trim();
  if (!tienda) {
    const r = await lemon('/stores');
    if (!r.data?.length) throw new Error('La cuenta no tiene ninguna tienda en Lemon Squeezy.');
    tienda = r.data[0].id;
    console.log(`IDs descubiertos → LEMONSQUEEZY_STORE_ID=${tienda}  (guárdalo: gh variable set LEMONSQUEEZY_STORE_ID -b ${tienda})`);
  }
  if (necesitaVariante && !variante) {
    const prods = await lemon(`/products?filter[store_id]=${tienda}&page[size]=100`);
    const base = prods.data?.find((p) => p.attributes?.name === 'Producto digital');
    if (!base) throw new Error('No encontré un producto llamado exactamente "Producto digital" en la tienda.');
    const vars = await lemon(`/variants?filter[product_id]=${base.id}`);
    if (!vars.data?.length) throw new Error('El producto "Producto digital" no tiene variantes.');
    variante = vars.data[0].id;
    console.log(`IDs descubiertos → LEMONSQUEEZY_VARIANT_ID=${variante}  (guárdalo: gh variable set LEMONSQUEEZY_VARIANT_ID -b ${variante})`);
  }
  return { tienda, variante };
}

/** Escribe una salida para pasos posteriores de GitHub Actions. */
export function salidaActions(clave, valor) {
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `${clave}=${String(valor).replace(/\n/g, ' ')}\n`, { flag: 'a' });
  }
}
