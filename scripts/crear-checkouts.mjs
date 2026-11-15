#!/usr/bin/env node
// Crea un checkout en Lemon Squeezy para cada producto "construido" sin checkout.
// Solo se ejecuta en GitHub Actions (necesita el secreto LEMONSQUEEZY_API_KEY).
//
// Modo prueba (LEMONSQUEEZY_TEST_MODE=true, por defecto): solo productos con prueba: true.
// Modo real  (LEMONSQUEEZY_TEST_MODE=false):               solo productos con prueba: false.
// Así ningún producto real queda "en venta" con un checkout de prueba.
import {
  listarProductos, escribirJSON, registrarActividad, escribirIndiceProductos,
  modoPrueba, urlSitio, lemon, descubrirIds, salidaActions,
} from './lib.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const test = modoPrueba();
const sitio = urlSitio();

async function principal() {
  const pendientes = listarProductos().filter(({ ficha: f }) =>
    f && f.estado === 'construido' && !f.checkout_url && (f.prueba === true) === test);

  if (!process.env.LEMONSQUEEZY_API_KEY) {
    console.log('::warning::Falta el secreto LEMONSQUEEZY_API_KEY: se omite la creación de checkouts. El sitio se publica igual.');
    if (pendientes.length) {
      registrarActividad('github-actions', `Aviso: falta LEMONSQUEEZY_API_KEY; ${pendientes.length} producto(s) esperan checkout`, null, { sinRepetir: true });
    }
    return 'Sin clave de Lemon Squeezy: checkouts omitidos';
  }

  if (!pendientes.length) {
    console.log(`No hay productos pendientes de checkout (modo ${test ? 'prueba' : 'real'}).`);
    return 'Sin checkouts pendientes';
  }

  let ids;
  try {
    ids = await descubrirIds();
  } catch (e) {
    console.log(`::error::${e.message}`);
    registrarActividad('github-actions', `Error al preparar Lemon Squeezy: ${e.message}`.slice(0, 200), null, { sinRepetir: true });
    return 'Error al conectar con Lemon Squeezy';
  }

  let creados = 0;
  let fallidos = 0;
  for (const { rel, ficha: f } of pendientes) {
    const descarga = `${sitio}/d/${f.token_descarga}/`;
    const descripcion = `<p>${esc(f.descripcion_corta)}</p><ul>${f.incluye.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    const cuerpo = {
      data: {
        type: 'checkouts',
        attributes: {
          custom_price: f.precio_usd_centavos,
          product_options: {
            name: f.nombre,
            description: descripcion,
            media: [`${sitio}/p/${f.slug}/${f.portada}`],
            redirect_url: descarga,
            receipt_link_url: descarga,
            receipt_button_text: 'Download your files',
            receipt_thank_you_note: 'Thanks for your purchase! Your download link is below.',
          },
          checkout_options: { embed: false, media: true, logo: true },
          checkout_data: { custom: { slug: f.slug } },
          expires_at: null,
          test_mode: test,
        },
        relationships: {
          store: { data: { type: 'stores', id: String(ids.tienda) } },
          variant: { data: { type: 'variants', id: String(ids.variante) } },
        },
      },
    };
    try {
      const r = await lemon('/checkouts', { metodo: 'POST', cuerpo });
      const url = r?.data?.attributes?.url;
      if (!url) throw new Error('la respuesta no trae la URL del checkout');
      f.checkout_url = url;
      f.checkout_id = String(r.data.id);
      f.estado = 'en_venta';
      escribirJSON(rel, f);
      registrarActividad('github-actions', `Checkout creado: ${f.nombre}${test ? ' (modo prueba)' : ''}`, `p/${f.slug}/`);
      console.log(`✓ ${f.slug}: checkout creado`);
      creados++;
    } catch (e) {
      console.log(`::error::${f.slug}: ${e.message}`);
      registrarActividad('github-actions', `Error creando checkout de ${f.slug}: ${e.message}`.slice(0, 200));
      fallidos++;
    }
  }
  return `${creados} checkout(s) creado(s)${fallidos ? `, ${fallidos} con error` : ''}`;
}

const resumen = await principal();
escribirIndiceProductos();
salidaActions('resumen', resumen);
console.log(resumen);
