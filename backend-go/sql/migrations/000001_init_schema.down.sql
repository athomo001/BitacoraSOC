-- Down migration del esquema inicial completo (Fase 2 del roadmap).
-- No se listan DROP TABLE por tabla: esta migración aplica TODO el núcleo de
-- una sola vez (ver spec/02-alcance-y-roadmap.md sección 5, Fase 2, y
-- spec/00-mapa-mental.md "todo 03-esquema-db.sql se aplica de una sola vez"),
-- así que revertirla es volver a un esquema public vacío, no desarmarla
-- tabla por tabla en orden inverso de FKs.
--
-- CAVEAT verificado corriendo `migrate down` de verdad: esto también borra
-- `schema_migrations` (la tabla de control que el propio golang-migrate crea
-- en `public`), así que `migrate` imprime un error al final al intentar
-- registrar la reversión en una tabla que esta misma migración acaba de
-- destruir. El reset SÍ se aplica igual (se puede confirmar contando tablas),
-- y el siguiente `migrate up` recrea `schema_migrations` y vuelve a aplicar
-- todo sin problema — es solo el mensaje de cierre de `down` el que es
-- confuso, no un fallo real. Para un reset local limpio sin ese mensaje,
-- preferir `docker compose down -v` (destruye el volumen completo) en vez de
-- `migrate down`.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
