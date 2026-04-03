# Complementos De Prueba (Subida Manual ZIP)

Se generaron 3 paquetes listos para subir desde Admin > Complementos:

1. `no-db-static.zip`: sin persistencia.
2. `internal-db-local.zip`: persistencia local en navegador (localStorage).
3. `external-db-api.zip`: integración contra API externa (simula BD externa).

## Carpeta de salida

Los ZIP se dejan en:

- `tools/complement-samples/dist/`

## Flujo sugerido de prueba

1. En Admin > Complementos, pestaña subir código, analiza ZIP.
2. Publica el complemento.
3. Abre el complemento desde el menú y ejecuta acciones.
4. Elimina el complemento con wipe-out.
5. Verifica:
   - El complemento ya no aparece en menú.
   - `GET /api/complements/:slug` devuelve 404 o acceso denegado.
   - Si era publicado por plataforma, no existe su carpeta en `backend/uploads/complements/published/<slug>`.

## Nota sobre "BD externa"

`external-db-api.zip` no abre una conexión SQL directa desde el navegador (eso no es seguro).

En su lugar llama una API externa (REST), que es la forma correcta de probar una "BD externa" desde un frontend.

Para una prueba real productiva, el patrón recomendado es:

- Complemento con backend propio.
- Credenciales guardadas como secreto (no en frontend).
- API del complemento consulta la BD externa.
