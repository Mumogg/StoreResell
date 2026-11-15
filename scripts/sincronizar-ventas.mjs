#!/usr/bin/env node
// Lee los pedidos de Lemon Squeezy y escribe data/ventas.json SIN datos personales.
// Solo se ejecuta en GitHub Actions (necesita el secreto LEMONSQUEEZY_API_KEY).
//
// Cada pedido se asigna a un producto probando, en orden:
//   1. custom_data  → el slug que mandamos en checkout_data.custom.slug, si la API lo devuelve
//   2. nombre       → el nombre del artículo del pedido coincide con el nombre de un producto
//   3. precio       → el precio del artículo coincide con el de un único producto
// Lo que no se pueda asignar va a "sin_asignar". El log muestra cuántos pedidos usó cada método.
import { leerJSON, escribirJSON, listarProductos, registrarActividad, modoPrueba, lemon, descubrirIds } from './lib.mjs';

const test = modoPrueba();
const redondear = (n) => Math.round(n * 100) / 100;

if (!process.env.LEMONSQUEEZY_API_KEY) {
  console.log('::warning::Falta el secreto LEMONSQUEEZY_API_KEY: no se sincronizan ventas.');
  process.exit(0);
}

const productos = listarProductos().filter((p) => p.ficha).map((p) => p.ficha);
const porSlug = new Map(productos.map((f) => [f.slug, f]));
const normal = (s) => String(s ?? '').trim().toLowerCase();

function buscarSlugCustom(pedido) {
  const a = pedido.attributes ?? {};
  const candidatos = [
    a.custom_data, a.meta?.custom_data, pedido.meta?.custom_data,
    a.first_order_item?.custom_data, a.checkout_data?.custom,
  ];
  for (const c of candidatos) if (c && typeof c === 'object' && porSlug.has(c.slug)) return c.slug;
  return null;
}

function asignar(pedido) {
  const porCustom = buscarSlugCustom(pedido);
  if (porCustom) return { slug: porCustom, metodo: 'custom_data' };
  const item = pedido.attributes?.first_order_item ?? {};
  const porNombre = productos.filter((f) => normal(f.nombre) === normal(item.product_name) || normal(f.nombre) === normal(item.variant_name));
  if (porNombre.length === 1) return { slug: porNombre[0].slug, metodo: 'nombre' };
  const porPrecio = productos.filter((f) => f.precio_usd_centavos === item.price && (f.prueba === true) === test);
  if (porPrecio.length === 1) return { slug: porPrecio[0].slug, metodo: 'precio' };
  return { slug: null, metodo: 'sin_asignar' };
}

try {
  const { tienda } = await descubrirIds({ necesitaVariante: false });
  const pedidos = [];
  const paises = new Map(); // id de cliente → país (lo único que se lee del cliente)
  let url = `/orders?filter[store_id]=${tienda}&page[size]=100&include=customer`;
  while (url) {
    const r = await lemon(url);
    pedidos.push(...(r.data ?? []));
    for (const inc of r.included ?? []) if (inc.type === 'customers') paises.set(String(inc.id), inc.attributes?.country ?? '');
    url = r.links?.next ?? null;
  }

  const ventas = {
    actualizado: new Date().toISOString(),
    modo_prueba: test,
    totales: { pedidos: 0, ingresos_usd: 0, reembolsos: 0 },
    por_producto: {},
    sin_asignar: { pedidos: 0, ingresos_usd: 0 },
    ultimos_pedidos: [],
    por_dia: {},
    asignacion: { custom_data: 0, nombre: 0, precio: 0, sin_asignar: 0 },
  };
  for (const f of productos) if ((f.prueba === true) === test) ventas.por_producto[f.slug] = { pedidos: 0, ingresos_usd: 0 };

  const delModo = pedidos
    .filter((p) => (p.attributes?.test_mode === true) === test)
    .sort((a, b) => Date.parse(b.attributes.created_at) - Date.parse(a.attributes.created_at));

  let camposImpresos = false;
  for (const p of delModo) {
    const a = p.attributes;
    if (!camposImpresos) {
      // Ayuda a verificar dónde llega custom.slug (solo nombres de campos, nunca valores).
      console.log(`Campos de un pedido: ${Object.keys(a).join(', ')}`);
      console.log(`¿Trae custom_data? ${buscarSlugCustom(p) ? 'sí' : 'no'}`);
      camposImpresos = true;
    }
    const estado = a.status ?? '';
    const totalUsd = (a.total_usd ?? 0) / 100;
    const reembolsado = (a.refunded_amount_usd ?? (estado === 'refunded' ? a.total_usd ?? 0 : 0)) / 100;
    const cuenta = ['paid', 'partial_refund', 'refunded'].includes(estado);
    const ingreso = cuenta ? Math.max(0, totalUsd - reembolsado) : 0;
    const { slug, metodo } = asignar(p);

    if (cuenta) {
      if (estado === 'refunded' || estado === 'partial_refund') ventas.totales.reembolsos++;
      if (estado !== 'refunded') {
        ventas.totales.pedidos++;
        ventas.asignacion[metodo]++;
        const bloque = slug ? (ventas.por_producto[slug] ??= { pedidos: 0, ingresos_usd: 0 }) : ventas.sin_asignar;
        bloque.pedidos++;
        bloque.ingresos_usd += ingreso;
        const dia = String(a.created_at).slice(0, 10);
        ventas.por_dia[dia] = (ventas.por_dia[dia] ?? 0) + ingreso;
      }
      ventas.totales.ingresos_usd += ingreso;
    }
    if (ventas.ultimos_pedidos.length < 20) {
      const idCliente = String(p.relationships?.customer?.data?.id ?? a.customer_id ?? '');
      ventas.ultimos_pedidos.push({
        fecha: a.created_at,
        slug: slug ?? '',
        total_usd: redondear(totalUsd),
        pais: paises.get(idCliente) ?? '',
        estado,
      });
    }
  }

  ventas.totales.ingresos_usd = redondear(ventas.totales.ingresos_usd);
  ventas.sin_asignar.ingresos_usd = redondear(ventas.sin_asignar.ingresos_usd);
  for (const b of Object.values(ventas.por_producto)) b.ingresos_usd = redondear(b.ingresos_usd);
  // Solo los últimos 90 días en la gráfica.
  ventas.por_dia = Object.fromEntries(Object.entries(ventas.por_dia).sort().slice(-90).map(([d, v]) => [d, redondear(v)]));

  const antes = leerJSON('data/ventas.json', null);
  escribirJSON('data/ventas.json', ventas);
  const nuevos = ventas.totales.pedidos - (antes?.modo_prueba === test ? antes?.totales?.pedidos ?? 0 : 0);
  if (nuevos > 0) {
    registrarActividad('github-actions', `${nuevos} pedido(s) nuevo(s) · total $${ventas.totales.ingresos_usd.toFixed(2)}${test ? ' (modo prueba)' : ''}`);
  }
  console.log(`✓ ${ventas.totales.pedidos} pedidos, $${ventas.totales.ingresos_usd} USD (modo ${test ? 'prueba' : 'real'}).`);
  console.log(`Método de asignación → ${JSON.stringify(ventas.asignacion)}`);
} catch (e) {
  console.log(`::error::No se pudieron sincronizar las ventas: ${e.message}`);
  registrarActividad('github-actions', `Error sincronizando ventas: ${e.message}`.slice(0, 200), null, { sinRepetir: true });
}
