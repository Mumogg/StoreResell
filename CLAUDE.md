# StoreResell — contrato para los agentes

Tienda de productos digitales automatizada. Los agentes escriben datos en este repo; **GitHub Actions** crea los checkouts, publica el sitio y sincroniza ventas. Los agentes no tienen internet salvo GitHub: nunca llames a Lemon Squeezy.

Agentes: `radar-ia-saas`, `radar-ecommerce` (investigadores), `constructor`, `github-actions` (no es un agente de la nube).

## Reglas para todos los agentes

1. **Al empezar**: marca tu entrada de `data/agentes.json` como `trabajando`.
   `node scripts/latido.mjs <tu-id> trabajando`
2. **Al terminar**: márcala `ok` o `error`, con `ultima_ejecucion` (ISO 8601) y `ultimo_resultado` (1 línea), y agrega 1–3 eventos a `data/actividad.json` (el más reciente primero, máx. 200).
   `node scripts/latido.mjs <tu-id> ok "3 oportunidades agregadas" --evento "Agregó 3 oportunidades de IA"`
   (el script pone la fecha, agrega el evento al inicio y recorta a 200; repite `--evento` en otra llamada si necesitas más de uno)
3. **Antes de cada commit**: `node scripts/validar.mjs`. Si falla, corrige y repite. No hagas commit con la validación rota.
4. **Commit directo a `main`** con mensaje `feat(<agente>): …`.
5. **Si el push falla por conflicto**: `git pull --rebase` y reintenta, hasta 3 veces.

## Investigadores (`radar-ia-saas`, `radar-ecommerce`)

- Agrega tus **3 oportunidades del día** a `data/oportunidades.json` con `estado: "detectada"`, `producto_slug: null`, `motivo_descarte: null`.
- **No dupliques**: compara con las oportunidades existentes por nombre e idea antes de agregar.
- `id`: `AAAA-MM-DD-ia-NN` o `AAAA-MM-DD-ec-NN`. `total` = `facilidad + ingresos + rapidez` (enteros de 0 a 10).
- `tipo_producto`: `pdf`, `plantilla`, `pack`, `guia`, `hoja-calculo` u `otro`. `fuentes`: URLs `https://`.

```json
{
  "id": "2026-11-16-ia-01", "fecha": "2026-11-16", "agente": "radar-ia-saas",
  "nombre": "…", "resumen": "2 frases", "por_que_ahora": "señal concreta",
  "fuentes": ["https://…"], "tipo_producto": "pdf", "cliente_ideal": "…",
  "precio_sugerido_usd": 12,
  "puntuacion": { "facilidad": 8, "ingresos": 6, "rapidez": 9 }, "total": 23,
  "estado": "detectada", "producto_slug": null, "motivo_descarte": null
}
```

## Constructor

1. Elige la oportunidad `detectada` con mayor `total` que se pueda construir **íntegramente como archivo digital** con herramientas locales. Si ninguna se puede construir, marca las inviables como `descartada` con su `motivo_descarte` y termina.
2. Márcala `en_construccion` y haz commit + push (así el panel lo muestra).
3. Crea `productos/<slug>/` con un producto **de calidad vendible**: contenido real y útil (no relleno), diseño cuidado, en inglés, 100 % original, sin marcas ni material con derechos de terceros.
   - `archivos/`: lo que recibe el comprador (pdf, zip, csv…).
   - `portada.png`: 1200×900, con el nombre del producto.
   - `producto.json`: ver esquema abajo. `token_descarga`: 32 caracteres aleatorios `[a-z0-9]`
     (`node -e "import('./scripts/lib.mjs').then(m=>console.log(m.cadenaAleatoria(32)))"`).
   - `precio_usd_centavos` = `precio_sugerido_usd × 100`.
4. Deja `estado: "construido"`, `checkout_url: null`, `checkout_id: null`, `prueba: false`. Actualiza la oportunidad a `construida` con su `producto_slug`.
5. Commit + push → GitHub Actions crea el checkout, lo pasa a `en_venta` y publica.
6. **Máximo 1 producto por ejecución.**

```json
{
  "slug": "igual-al-nombre-de-la-carpeta", "oportunidad_id": "2026-11-16-ia-01",
  "nombre": "Product Name", "subtitulo": "…", "descripcion_corta": "máx. 160 caracteres",
  "descripcion_larga_md": "markdown: beneficios, qué incluye, para quién es",
  "incluye": ["40-page PDF", "Spreadsheet"],
  "precio_usd_centavos": 1200, "categoria": "IA", "idioma": "en",
  "portada": "portada.png", "archivos": ["archivos/file.pdf"],
  "token_descarga": "32 caracteres [a-z0-9]",
  "estado": "construido", "checkout_url": null, "checkout_id": null,
  "creado_por": "constructor", "fecha_creacion": "2026-11-16", "prueba": false
}
```

## Nunca

- Tocar `.github/`, `scripts/`, `plantillas/`, `data/ventas.json`, `data/config.json` ni `data/productos.json` (lo genera el build).
- Poner `estado: "en_venta"` o escribir `checkout_url`/`checkout_id`: eso lo hace GitHub Actions.
- Escribir secretos, claves o datos personales en ningún archivo, log o commit.
- Borrar productos en venta. Para retirar uno: `estado: "pausado"`.
- Cambiar el `token_descarga` o el `slug` de un producto ya publicado (rompe los enlaces de quienes compraron).

## Comandos útiles

```bash
node scripts/validar.mjs        # valida todos los JSON
node scripts/build-site.mjs     # genera dist/ (opcional, para revisar)
node scripts/latido.mjs --help  # uso del latido
```
