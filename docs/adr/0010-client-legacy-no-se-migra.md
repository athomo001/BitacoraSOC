---
status: accepted
---

# `Client.js` legacy no se migra — ya superado por `CatalogLogSource`

Quedaba abierto el rol real de `backend/src/models/Client.js` vs `backend/src/models/CatalogLogSource.js` antes de cerrar el mapeo de migración de `clients`. Investigación del código real: `Client` no aparece en ningún controlador ni ruta de negocio activa — solo lo tocan el dump genérico de backups (`backup-manifest.js`), el seed, y un script de migración ya ejecutado en el propio legacy, `migrate-escalation-clients-to-log-sources.js`, cuyo nombre lo dice todo: los `Client` existentes ya fueron consolidados hacia `CatalogLogSource` (por nombre normalizado) hace tiempo. `CatalogLogSource` es el modelo realmente vivo (escalación, directorio, catálogo, entradas, usuarios) y ya carga el campo `parent` (texto libre) que identifica al cliente/organización dueña de ese log source. **Decisión**: `Client` no entra en el orden de migración del corte — no hay nada que portar desde ahí que `CatalogLogSource`/`organizations` no cubran ya. La limpieza real de la migración es la ya prevista: `CatalogLogSource.parent` (texto libre) → `organizations` relacional (ver `02-alcance-y-roadmap.md` sección 2 punto 3).
