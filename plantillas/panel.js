// Panel de control: lee los JSON publicados en /data/ y se refresca cada 60 s.
const BASE = document.body.dataset.base || '';
const REFRESCO_MS = 60_000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (n) => `$${Number(n || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const urlSegura = (u) => (/^https?:\/\//.test(u) ? u : `${BASE}/${String(u).replace(/^\/+/, '')}`);

const NOMBRES_ESTADO = { esperando: 'Esperando', trabajando: 'Trabajando', ok: 'OK', error: 'Error' };
const ESTADOS_PEDIDO = { paid: 'Pagado', refunded: 'Reembolsado', partial_refund: 'Reembolso parcial', pending: 'Pendiente', failed: 'Fallido', fraudulent: 'Fraude' };
let orden = { clave: 'ingresos_usd', asc: false };
let ultimo = null;

async function cargar(nombre, porDefecto) {
  const r = await fetch(`${BASE}/data/${nombre}.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) {
    if (porDefecto !== undefined) return porDefecto;
    throw new Error(`${nombre}.json → ${r.status}`);
  }
  return r.json();
}

function haceCuanto(iso) {
  if (!iso) return 'Nunca';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** Horas transcurridas desde `iso` sin contar sábados ni domingos. */
function horasLaborales(iso) {
  const fin = Date.now();
  let t = Date.parse(iso);
  if (fin - t > 60 * 24 * 3600e3) return Infinity;
  let horas = 0;
  for (; t < fin; t += 3600e3) {
    const dia = new Date(t).getDay();
    if (dia !== 0 && dia !== 6) horas++;
  }
  return horas;
}

function pintarAgentes(agentes, nombres) {
  const hoy = new Date().getDay();
  const esLaboral = hoy !== 0 && hoy !== 6;
  $('agentes').innerHTML = agentes.map((a) => {
    nombres[a.id] = a.nombre;
    const atrasado = esLaboral && a.ultima_ejecucion && horasLaborales(a.ultima_ejecucion) > 30;
    return `<article class="agente${atrasado || a.estado === 'error' ? ' agente--alerta' : ''}">
      <div class="agente__cab">
        <div><div class="agente__nombre">${esc(a.nombre)}</div><div class="agente__rol">${esc(a.rol)}</div></div>
        <span class="estado estado--${esc(a.estado)}">${esc(NOMBRES_ESTADO[a.estado] || a.estado)}</span>
      </div>
      <dl class="agente__datos">
        <dt>Horario</dt><dd>${esc(a.horario)}</dd>
        <dt>Última ejecución</dt><dd title="${esc(a.ultima_ejecucion || '')}">${esc(haceCuanto(a.ultima_ejecucion))}</dd>
      </dl>
      <div class="agente__resultado">${esc(a.ultimo_resultado)}</div>
      ${atrasado ? '<div class="agente__alerta">⚠ Más de 30 h laborales sin ejecutarse</div>' : ''}
    </article>`;
  }).join('');
}

function tarjeta({ nombre, agente, total, fuentes = [], slug, prueba, motivo }) {
  const enlaces = [
    ...fuentes.filter((f) => /^https?:\/\//.test(f)).map((f, i) => `<a href="${esc(f)}" target="_blank" rel="noopener noreferrer">Fuente ${i + 1}</a>`),
    slug ? `<a href="${BASE}/p/${esc(slug)}/">Producto →</a>` : '',
  ].filter(Boolean).join('');
  return `<div class="op">
    <div class="op__nombre">${esc(nombre)}${prueba ? '<span class="chapa">PRUEBA</span>' : ''}</div>
    <div class="op__meta"><span>${esc(agente)}</span>${total != null ? `<span class="op__total" title="Puntuación total">${esc(total)}</span>` : ''}</div>
    ${motivo ? `<div class="op__motivo">Motivo: ${esc(motivo)}</div>` : ''}
    ${enlaces ? `<div class="op__enlaces">${enlaces}</div>` : ''}
  </div>`;
}

function pintarPipeline(oportunidades, productos, nombres) {
  const columnas = [
    { id: 'detectada', nombre: 'Detectada', color: 'var(--esperando)' },
    { id: 'en_construccion', nombre: 'En construcción', color: 'var(--trabajando)' },
    { id: 'construida', nombre: 'Construida', color: 'var(--acento)' },
    { id: 'en_venta', nombre: 'En venta', color: 'var(--ok)' },
  ];
  const porSlug = Object.fromEntries(productos.map((p) => [p.slug, p]));
  const grupos = { detectada: [], en_construccion: [], construida: [], en_venta: [], descartada: [] };
  const conOportunidad = new Set();

  for (const o of [...oportunidades].sort((a, b) => (b.total ?? 0) - (a.total ?? 0))) {
    const prod = o.producto_slug ? porSlug[o.producto_slug] : null;
    if (prod) conOportunidad.add(prod.slug);
    // El estado real de venta lo marca el producto (lo actualiza GitHub Actions).
    let estado = o.estado;
    if (estado !== 'descartada' && prod?.estado === 'en_venta') estado = 'en_venta';
    (grupos[estado] || grupos.detectada).push(tarjeta({
      nombre: o.nombre, agente: nombres[o.agente] || o.agente, total: o.total, fuentes: o.fuentes,
      slug: prod && prod.estado !== 'pausado' ? prod.slug : null, prueba: prod?.prueba, motivo: o.motivo_descarte,
    }));
  }
  // Productos sin oportunidad asociada (p. ej. el producto de prueba).
  for (const p of productos) {
    if (conOportunidad.has(p.slug) || p.estado === 'pausado') continue;
    grupos[p.estado === 'en_venta' ? 'en_venta' : 'construida'].push(tarjeta({
      nombre: p.nombre, agente: 'Sin oportunidad asociada', total: null, slug: p.slug, prueba: p.prueba,
    }));
  }

  $('pipeline').innerHTML = columnas.map((c) => `<div class="columna" style="--c:${c.color}">
      <div class="columna__cab"><span>${c.nombre}</span><span class="columna__n">${grupos[c.id].length}</span></div>
      <div class="columna__lista">${grupos[c.id].join('') || '<p class="nada">Vacío</p>'}</div>
    </div>`).join('');

  const d = $('descartadas');
  d.hidden = grupos.descartada.length === 0;
  d.querySelector('summary').textContent = `Descartadas (${grupos.descartada.length})`;
  d.querySelector('.descartadas__lista').innerHTML = grupos.descartada.join('');
}

function grafica(porDia) {
  const dias = [];
  const hoy = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - i));
    const clave = d.toISOString().slice(0, 10);
    dias.push({ clave, valor: Number(porDia[clave] || 0) });
  }
  const max = Math.max(...dias.map((d) => d.valor));
  if (max <= 0) return '<p class="nada">Todavía no hay ingresos en los últimos 30 días.</p>';
  const W = 600, H = 200, izq = 44, abajo = 22, arriba = 10;
  const alto = H - abajo - arriba;
  const paso = (W - izq) / dias.length;
  const tope = Math.ceil(max / 10) * 10 || 10;
  const barras = dias.map((d, i) => {
    const h = (d.valor / tope) * alto;
    return `<rect class="barra" x="${(izq + i * paso + 2).toFixed(1)}" y="${(arriba + alto - h).toFixed(1)}" width="${(paso - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${d.clave}: ${dinero(d.valor)}</title></rect>`;
  }).join('');
  const marcas = [0, 0.5, 1].map((f) => {
    const y = arriba + alto - f * alto;
    return `<line class="eje" x1="${izq}" x2="${W}" y1="${y}" y2="${y}"/><text x="${izq - 6}" y="${y + 4}" text-anchor="end">$${Math.round(tope * f)}</text>`;
  }).join('');
  const fechas = [0, 10, 20, 29].map((i) => `<text x="${(izq + i * paso + paso / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${dias[i].clave.slice(8)}/${dias[i].clave.slice(5, 7)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos por día de los últimos 30 días">${marcas}${barras}${fechas}</svg>`;
}

function pintarTablaProductos(ventas, productos) {
  const nombres = Object.fromEntries(productos.map((p) => [p.slug, p.nombre]));
  const filas = Object.entries(ventas.por_producto || {}).map(([slug, v]) => ({ slug, nombre: nombres[slug] || slug, pedidos: v.pedidos, ingresos_usd: v.ingresos_usd }));
  if (ventas.sin_asignar?.pedidos) filas.push({ slug: '', nombre: 'Sin asignar', pedidos: ventas.sin_asignar.pedidos, ingresos_usd: ventas.sin_asignar.ingresos_usd });
  const tabla = $('tabla-productos');
  if (!filas.length) { tabla.innerHTML = '<tbody><tr><td class="nada">Aún no hay productos con ventas registradas.</td></tr></tbody>'; return; }
  filas.sort((a, b) => {
    const x = a[orden.clave], y = b[orden.clave];
    const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es');
    return orden.asc ? r : -r;
  });
  const flecha = (k) => (orden.clave === k ? (orden.asc ? '▲' : '▼') : '↕');
  const th = (k, texto, num) => `<th class="${num ? 'num' : ''}" aria-sort="${orden.clave === k ? (orden.asc ? 'ascending' : 'descending') : 'none'}"><button type="button" data-orden="${k}">${texto} <span aria-hidden="true">${flecha(k)}</span></button></th>`;
  tabla.innerHTML = `<thead><tr>${th('nombre', 'Producto')}${th('pedidos', 'Pedidos', true)}${th('ingresos_usd', 'Ingresos', true)}</tr></thead>
    <tbody>${filas.map((f) => `<tr><td>${f.slug ? `<a href="${BASE}/p/${esc(f.slug)}/">${esc(f.nombre)}</a>` : esc(f.nombre)}</td><td class="num">${f.pedidos}</td><td class="num">${dinero(f.ingresos_usd)}</td></tr>`).join('')}</tbody>`;
}

function pintarVentas(ventas, productos) {
  $('modo').hidden = !ventas.modo_prueba;
  const t = ventas.totales || {};
  const cifra = (valor, nombre) => `<div class="cifra"><div class="cifra__valor">${valor}</div><div class="cifra__nombre">${nombre}</div></div>`;
  $('cifras').innerHTML =
    cifra(dinero(t.ingresos_usd), `Ingresos totales${ventas.modo_prueba ? ' (prueba)' : ''}`) +
    cifra(t.pedidos ?? 0, 'Pedidos') +
    cifra(t.reembolsos ?? 0, 'Reembolsos') +
    cifra(productos.filter((p) => p.estado === 'en_venta' && !p.prueba).length, 'Productos en venta') +
    cifra(esc(ventas.actualizado ? haceCuanto(ventas.actualizado) : 'Nunca'), 'Última sincronización');

  let porDia = ventas.por_dia;
  if (!porDia) {
    porDia = {};
    for (const p of ventas.ultimos_pedidos || []) if (p.estado === 'paid') porDia[p.fecha.slice(0, 10)] = (porDia[p.fecha.slice(0, 10)] || 0) + p.total_usd;
  }
  $('grafica').innerHTML = grafica(porDia);
  pintarTablaProductos(ventas, productos);

  const pedidos = ventas.ultimos_pedidos || [];
  $('tabla-pedidos').innerHTML = pedidos.length
    ? `<thead><tr><th>Fecha</th><th>Producto</th><th>País</th><th>Estado</th><th class="num">Total</th></tr></thead>
      <tbody>${pedidos.map((p) => `<tr><td>${esc(new Date(p.fecha).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${esc(p.slug || 'Sin asignar')}</td><td>${esc(p.pais || '—')}</td><td><span class="pastilla pastilla--${esc(p.estado)}">${esc(ESTADOS_PEDIDO[p.estado] || p.estado)}</span></td><td class="num">${dinero(p.total_usd)}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="nada">Todavía no hay pedidos.</td></tr></tbody>';
}

function pintarActividad(actividad, nombres) {
  $('actividad').innerHTML = actividad.slice(0, 50).map((e) => `<li>
      <div class="linea__msg">${esc(e.mensaje)}${e.enlace ? ` <a href="${esc(urlSegura(e.enlace))}">ver →</a>` : ''}</div>
      <div class="linea__meta">${esc(nombres[e.agente] || e.agente)} · <time datetime="${esc(e.fecha)}" title="${esc(new Date(e.fecha).toLocaleString('es'))}">${esc(haceCuanto(e.fecha))}</time></div>
    </li>`).join('') || '<p class="nada">Sin actividad todavía.</p>';
}

async function refrescar() {
  try {
    const [agentes, oportunidades, productos, ventas, actividad] = await Promise.all([
      cargar('agentes'), cargar('oportunidades', []), cargar('productos', []), cargar('ventas'), cargar('actividad', []),
    ]);
    ultimo = { ventas, productos };
    const nombres = {};
    pintarAgentes(agentes, nombres);
    pintarPipeline(oportunidades, productos, nombres);
    pintarVentas(ventas, productos);
    pintarActividad(actividad, nombres);
    $('error').hidden = true;
    $('refresco').textContent = `Actualizado ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} · se refresca cada 60 s`;
  } catch (e) {
    $('error').hidden = false;
    $('error').textContent = `No se pudieron cargar los datos (${e.message}). Se reintentará en 60 s.`;
  }
}

$('tabla-productos').addEventListener('click', (ev) => {
  const boton = ev.target.closest('[data-orden]');
  if (!boton || !ultimo) return;
  const clave = boton.dataset.orden;
  orden = { clave, asc: orden.clave === clave ? !orden.asc : clave === 'nombre' };
  pintarTablaProductos(ultimo.ventas, ultimo.productos);
});

refrescar();
setInterval(refrescar, REFRESCO_MS);
