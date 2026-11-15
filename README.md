# StoreResell

Tienda de productos digitales automatizada por agentes de IA.

- **Tienda:** https://mumogg.github.io/StoreResell/
- **Panel de control:** `https://mumogg.github.io/StoreResell/<panel_slug>/` (el valor está en `data/config.json`)

## Cómo funciona

```
Investigadores ──► data/oportunidades.json
                        │
Constructor ────► productos/<slug>/  (estado: construido)
                        │  push a main
GitHub Actions ─► crea el checkout en Lemon Squeezy ─► estado: en_venta
                  genera el sitio (dist/) ─► GitHub Pages
                  una vez al día: pedidos ─► data/ventas.json ─► panel
```

1. **Agentes investigadores** (`radar-ia-saas`, `radar-ecommerce`): escriben oportunidades en `data/oportunidades.json`.
2. **Agente constructor**: toma la mejor oportunidad y crea el producto en `productos/<slug>/`.
3. **GitHub Actions** (`publicar.yml`): valida, crea los checkouts que falten, genera el sitio y lo despliega.
4. **GitHub Actions** (`ventas.yml`, diario 13:17 UTC): sincroniza pedidos y vuelve a publicar.

Los agentes de la nube solo tienen acceso a GitHub; **toda llamada a Lemon Squeezy ocurre en GitHub Actions**. Las reglas que siguen los agentes están en [`CLAUDE.md`](CLAUDE.md).

## Estructura

| Ruta | Qué es |
|---|---|
| `data/agentes.json` | Estado (latido) de cada agente |
| `data/oportunidades.json` | Oportunidades detectadas por los investigadores |
| `data/productos.json` | Índice de productos, generado por los scripts (no editar) |
| `data/ventas.json` | Ventas agregadas, sin datos personales (lo escribe `ventas.yml`) |
| `data/actividad.json` | Últimos 200 eventos |
| `data/config.json` | Nombre de la tienda, URL del sitio y ruta fija del panel |
| `productos/<slug>/` | `producto.json`, `portada.png` y `archivos/` |
| `plantillas/` | HTML, CSS y JS del sitio |
| `scripts/` | Validación, build, checkouts, ventas y latido |

## Uso local

Requiere solo Node 20+ (sin paquetes npm).

```bash
node scripts/validar.mjs                 # valida todos los JSON
node scripts/build-site.mjs              # genera dist/ con base /StoreResell
BASE_PATH= node scripts/build-site.mjs   # genera dist/ para servir en la raíz
python3 -m http.server -d dist 8000      # (con BASE_PATH vacío) http://localhost:8000
```

## Configuración en GitHub

| Tipo | Nombre | Valor |
|---|---|---|
| Secreto | `LEMONSQUEEZY_API_KEY` | Clave de API de Lemon Squeezy (de prueba o real) |
| Variable | `LEMONSQUEEZY_TEST_MODE` | `true` (por defecto) o `false` |
| Variable | `LEMONSQUEEZY_STORE_ID` | Opcional: si falta, se usa la primera tienda y el log muestra el ID |
| Variable | `LEMONSQUEEZY_VARIANT_ID` | Opcional: si falta, se busca la primera variante del producto llamado exactamente **"Producto digital"** |

Sin el secreto nada falla: el sitio se publica igual y los productos sin checkout muestran "Coming soon".

### Modo prueba y modo real

- **Modo prueba** (`LEMONSQUEEZY_TEST_MODE=true`): solo se crean checkouts para productos con `prueba: true`. Los productos reales se quedan en "Coming soon".
- **Modo real** (`false`): solo se crean checkouts para productos con `prueba: false`.

Así un producto real nunca queda "en venta" con un checkout de prueba. Los productos con `prueba: true` no aparecen en la tienda ni en el sitemap; su página existe (con `noindex`) para poder hacer la compra de prueba desde el panel.

En Lemon Squeezy los productos de modo prueba y de modo real son distintos: al pasar a modo real hay que actualizar (o borrar) `LEMONSQUEEZY_VARIANT_ID`.

## Cómo se asignan los pedidos a los productos

`scripts/sincronizar-ventas.mjs` prueba, en este orden:

1. **`custom_data`**: el `slug` enviado en `checkout_data.custom.slug`, si la respuesta de pedidos lo trae.
2. **Nombre**: el nombre del artículo del pedido coincide con el nombre de un producto.
3. **Precio**: el precio del artículo coincide con el de un único producto.

Lo que no se pueda asignar va a `sin_asignar`. El log de `ventas.yml` imprime los campos que trae un pedido y cuántos pedidos usó cada método (también queda en `ventas.json → asignacion`).

> **Pendiente de verificar con una compra de prueba real:** todavía no se ha comprobado contra la API real cuál de los tres métodos funciona. Después de la primera compra de prueba, mira la línea `Método de asignación → …` en el log de `ventas.yml` y anota aquí el resultado.

## Seguridad y límites conocidos

- La clave de Lemon Squeezy vive solo como secreto de GitHub. Los scripts nunca la imprimen.
- `data/ventas.json` no guarda emails ni nombres; el validador lo comprueba.
- **El repositorio es público**: los archivos de `productos/*/archivos/` y los `token_descarga` se pueden ver en GitHub sin comprar. Las páginas `/d/<token>/` y el panel no están enlazados y llevan `noindex`, pero no son privados. Es una limitación de usar GitHub Pages gratis.
- `robots.txt` se publica en `/StoreResell/robots.txt`; los buscadores solo leen el de la raíz del dominio, así que la protección real contra indexación son las etiquetas `noindex`.
