#!/usr/bin/env node
// Actualiza el latido de un agente y, opcionalmente, registra un evento de actividad.
// Uso:
//   node scripts/latido.mjs <agente> trabajando
//   node scripts/latido.mjs <agente> ok "3 oportunidades agregadas" --evento "Agregó 3 oportunidades" [--enlace URL]
import { actualizarAgente, registrarActividad, AGENTES } from './lib.mjs';

const args = process.argv.slice(2);
const opcion = (nombre) => {
  const i = args.indexOf(nombre);
  if (i === -1) return null;
  const [, valor] = args.splice(i, 2);
  return valor ?? null;
};
const evento = opcion('--evento');
const enlace = opcion('--enlace');
const [id, estado, resultado] = args;

if (!AGENTES.includes(id) || !['esperando', 'trabajando', 'ok', 'error'].includes(estado)) {
  console.error('Uso: node scripts/latido.mjs <agente> <esperando|trabajando|ok|error> ["resultado"] [--evento "mensaje"] [--enlace URL]');
  console.error(`Agentes: ${AGENTES.join(', ')}`);
  process.exit(1);
}

const cambios = { estado };
if (estado === 'ok' || estado === 'error') cambios.ultima_ejecucion = new Date().toISOString();
if (resultado !== undefined) cambios.ultimo_resultado = resultado;
actualizarAgente(id, cambios);
if (evento) registrarActividad(id, evento, enlace);
console.log(`✓ ${id} → ${estado}${resultado ? ` (${resultado})` : ''}`);
