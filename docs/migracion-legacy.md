# Migración desde el legacy

Cómo pasar los datos del sistema anterior (BitacoraSOC v1.x: Node + MongoDB) a Bitácora Ops 2.0, y cómo comprobar que quedaron bien antes del corte.

- [1. Contexto](#1-contexto)
- [2. El proceso completo](#2-el-proceso-completo)
- [3. ETL: `legacy-etl`](#3-etl-legacy-etl)
- [4. Comparador de escalamiento: `escalation-shadow-diff`](#4-comparador-de-escalamiento-escalation-shadow-diff)
- [5. Semilla territorial: `territorial-seed`](#5-semilla-territorial-territorial-seed)
- [6. Día del corte](#6-día-del-corte-secuencia-recomendada)
- [7. Problemas comunes](#7-problemas-comunes)

---

## 1. Contexto

- El **legacy sigue en producción** hasta el corte. El corte **no tiene fecha fija**: se hace cuando la 2.0 está lista.
- Por eso el ETL está hecho para **repetirse** cuantas veces haga falta, siempre desde un respaldo nuevo del legacy, contra una base de ensayo vacía.
- **Nunca se conecta a la base de producción del legacy.** Solo lee el archivo de respaldo que el legacy genera.
- El código del legacy está congelado en el tag `legacy-v1-final` y se consulta en la carpeta hermana `../BitacoraSOC-legacy/`:

  ```bash
  git worktree add --detach ../BitacoraSOC-legacy legacy-v1-final   # si hay que recrearla
  ```

> **Los respaldos del legacy contienen datos personales y llaves.** Guárdalos solo en `respaldos/` (está fuera de git). Nunca en el repositorio ni en otras carpetas.

---

## 2. El proceso completo

```mermaid
flowchart TD
    A["Legacy: generar respaldo<br/>(ZIP automático o manual)"] --> B["Copiarlo a respaldos/"]
    B --> C["scripts/etl-reset.sh<br/>base bitacora_etl vacía y migrada"]
    C --> D["legacy-etl -dry-run<br/>revisar el reporte"]
    D --> E{¿Descartes<br/>explicados?}
    E -- No --> F["Corregir datos en el legacy<br/>o ajustar el ETL"] --> A
    E -- Sí --> G["legacy-etl -output-dir<br/>genera respaldo 2.0"]
    G --> H["2.0: Respaldos → Subir → Restaurar"]
    H --> I["escalation-shadow-diff<br/>compara escalamiento"]
    I --> J["Revisión del SOC<br/>pantallas con datos reales"]
```

---

## 3. ETL: `legacy-etl`

### Qué hace

Lee el respaldo del legacy (ZIP o `data.json`), descifra lo cifrado con las llaves del legacy y lo carga en una base 2.0 vacía. Los secretos se vuelven a cifrar con la llave 2.0. Al final **verifica** lo cargado y escribe un reporte paso a paso: cuánto leyó, cuánto cargó y por qué descartó cada cosa.

```mermaid
flowchart LR
    Z["ZIP del legacy"] --> K["Llaves:<br/>keyring del ZIP<br/>+ .env del legacy"]
    Z --> J["data.json"]
    K --> T["Transformar<br/>~30 pasos"]
    J --> T
    T --> DB[("bitacora_etl")]
    DB --> V["Verificación<br/>índices y descifrado"]
    V --> R["Reporte JSON + tabla"]
    DB -. "-output-dir" .-> O["Respaldo 2.0 (.enc)"]
```

Pasos principales, en orden: usuarios y grupos → organizaciones y servicios → directorio → turnos y checklist → entradas → historial de checklists → notas → correo → escalamiento y flujos de llamada → RACI → guardias y dotación → complementos → avisos por cliente → reportes y eventos → configuración y marca → auditoría → verificación.

### Uso

```bash
# 1. Base de ensayo vacía con todas las migraciones (nunca toca la base "bitacora")
scripts/etl-reset.sh

# 2. Ensayo en seco: carga todo y lo deshace; solo deja el reporte
set -a && . ./.env && set +a
cd backend-go
go run ./cmd/legacy-etl \
  -backup ../respaldos/backup-2026-09-25T23-01-23-401Z.zip \
  -legacy-env ../../BitacoraSOC-legacy/.env \
  -database-url "postgres://bitacora:${POSTGRES_PASSWORD}@127.0.0.1:25432/bitacora_etl?sslmode=disable" \
  -dry-run
```

### Parámetros

| Parámetro | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `-backup` | ruta | Sí | Respaldo del legacy: el ZIP (automático o manual) o su `data.json`. |
| `-database-url` | URL | Sí (o `ETL_DATABASE_URL`) | Base destino, **vacía y migrada** (normalmente `bitacora_etl`). |
| `-legacy-env` | ruta | Opcional | `.env` del legacy, para su `ENCRYPTION_KEY`. Opcional si el ZIP trae su keyring. |
| `-legacy-keyring` | ruta | Opcional | Keyring del legacy. Por defecto, `backend/secrets/encryption-keyring.json` junto al `.env`. |
| `-dry-run` | bool | Opcional | Hace toda la carga y la deshace. Deja solo el reporte. |
| `-report` | ruta | Opcional | Dónde guardar el reporte JSON. Por defecto, junto a la exportación. |
| `-output-dir` | ruta | Opcional | Deja ahí un **respaldo en formato 2.0**, listo para subir en *Administración → Respaldos*. |

| Variable | Descripción |
| --- | --- |
| `APP_ENCRYPTION_KEY` | Llave 2.0 con la que se recifran los secretos. **Debe ser la misma de la instalación destino.** |
| `LEGACY_BACKUP_PASSPHRASE` | Frase del respaldo del legacy, si lo tiene. |
| `ETL_OUTPUT_PASSPHRASE` | Frase del respaldo 2.0 de `-output-dir`. Sin ella, queda cifrado con `APP_ENCRYPTION_KEY` y la 2.0 lo restaura sin pedir frase. |

### Salida (extracto real, nombres omitidos)

```text
Llaves del legacy disponibles: 3 (del respaldo: 1)
Archivos subidos en el respaldo: 16
Exportación del legacy 2026-09-25T23:01:23.401Z (formato 3.1)

paso                                 leídos cargados  descartes
usuarios                                 12       12          0
    ↳ 5 grupos de permisos SOC según el cargo del legacy, con 7 usuarios
organizaciones                           28       16         12
    · 7 empresa de contactos que ya era cliente (unida)
    · 5 mismo cliente en clients y catalogLogSources (unido)
entradas                                966      966          0
historial de checklists                 339      339          0
    ↳ 4976 servicios revisados; a 215 checks sin turno guardado se les dedujo por la hora
guardias y dotación                     330      324          6
    · 6 guardia de alguien que no viene en la exportación
    ↳ 312 días de dotación y 84 semanas de guardia
eventos de reporte                     1863     1858          5
    · 5 sin nombre o repetido
auditoría                             21786    21786          0
verificación                            102      102          0
    ↳ 102 canales de contacto se descifran con la llave 2.0; todas las contraseñas son bcrypt
```

Cómo leerlo:

- `·` explica un **descarte o una unión**. "Unido" no es pérdida: dos registros del legacy que eran lo mismo pasan a ser uno.
- `↳` es información de lo cargado.
- La fila **verificación** debe quedar con `leídos = cargados`.

### Llevar el resultado a la 2.0

```bash
go run ./cmd/legacy-etl -backup … -database-url … -output-dir ../respaldos/etl-salida
```

```text
Respaldo 2.0 listo (<N> registros): ../respaldos/etl-salida/<id>.full.zst.enc
Súbelo en Administración → Respaldos (arrástralo a la zona de subida) y restáuralo.
```

En la instalación 2.0: *Administración → Respaldos → Subir*, y luego **Restaurar · reemplazar** (escribiendo `RESTAURAR`).

---

## 4. Comparador de escalamiento: `escalation-shadow-diff`

### Qué hace

Para cada servicio del legacy compara **a quién escalaba el legacy** con lo que responde el **motor nuevo**, y genera un reporte de diferencias. **Solo lee**: consulta `/api/escalation/resolve`, nunca registra intentos ni envía correos.

### Uso

```bash
mongoexport --db <base> --collection catalogLogSources --jsonArray -o catalogLogSources.json   # en el legacy

SHADOW_DIFF_TOKEN=<jwt de un usuario 2.0> go run ./cmd/escalation-shadow-diff \
  -legacy catalogLogSources.json -map mapeo.json \
  -api http://127.0.0.1:8081 -out reporte.md
```

| Parámetro | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `-legacy` | ruta | Sí | Export JSON (arreglo) de `catalogLogSources`. Usa `name` y `escalationFlow`. |
| `-map` | ruta | Sí | JSON que dice contra qué comparar cada caso: `{"<nombre legacy>": {"serviceId": "<uuid>"}}`. También acepta `assetId` o `territorialUnitId`. |
| `-api` | URL | Opcional | URL base de la 2.0 (por defecto `http://127.0.0.1:8081`). |
| `-out` | ruta | Opcional | Archivo del reporte. Por defecto, la salida estándar. |
| `-json` | bool | Opcional | Reporte en JSON en vez de Markdown. |
| `-aviso-paso-1` | bool | Opcional | Ignora el primer paso del motor nuevo: el aviso por correo que agrega el ETL. |
| `SHADOW_DIFF_TOKEN` | variable | Sí | JWT de un usuario de la 2.0. |

Antes del corte, toda diferencia debe estar **explicada** y revisada por el SOC.

---

## 5. Semilla territorial: `territorial-seed`

Genera el archivo de territorio (país → regiones → zonas) de cualquier país a partir del dataset abierto [dr5hn/countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database). El de Chile ya viene en `seed/territorial_units_chile.json`.

```bash
go run ./cmd/territorial-seed -in countries+states+cities.json -country CL -out ../seed/territorial_units_chile.json
```

| Parámetro | Requerido | Descripción |
| --- | --- | --- |
| `-in` | Sí | `countries+states+cities.json` del dataset. |
| `-country` | Sí | Código ISO 3166-1 alfa-2 (por ejemplo `CL`). |
| `-out` | Opcional | Archivo de salida. Por defecto, la salida estándar. |

| Del dataset | En la 2.0 | Código |
| --- | --- | --- |
| País | `country` | ISO2 (`CL`) |
| Estado / región | `region` | ISO 3166-2 (`CL-RM`) |
| Ciudad | `zone` | región + nombre (`CL-AN-CALAMA`) |

El archivo se importa en *Administración → Territorio → Importar*. Los datos son ODbL: requieren atribución (ver `THIRD-PARTY-NOTICES.md`).

---

## 6. Día del corte (secuencia recomendada)

```mermaid
flowchart LR
    A["Aviso a los usuarios"] --> B["Legacy en solo lectura<br/>o detenido"]
    B --> C["Último respaldo del legacy"]
    C --> D["ETL + verificación"]
    D --> E["Restaurar en la 2.0"]
    E --> F["Pruebas de humo"]
    F --> G["Cambiar DNS / enlace"]
    G --> H["Ventana de vuelta atrás<br/>14 días"]
```

- El legacy **no se borra**: queda disponible para volver atrás durante **14 días** ([ADR 0003](adr/0003-corte-unico-ventana-rollback-14-dias.md)).
- Pruebas de humo mínimas: login, bitácora, checklist de inicio, escalamiento de un servicio, envío de un correo de prueba y "de guardia ahora".
- Aplica en producción **todas** las migraciones hasta la última (`000030`) antes de restaurar.

---

## 7. Problemas comunes

| Mensaje | Causa | Solución |
| --- | --- | --- |
| `el respaldo viene cifrado con contraseña: defínela en LEGACY_BACKUP_PASSPHRASE` | El ZIP del legacy se hizo con frase. | `export LEGACY_BACKUP_PASSPHRASE='…'` y vuelve a correr. |
| Canales o secretos que no se descifran en la verificación | Falta una llave del legacy. | Indica `-legacy-env` (y `-legacy-keyring` si está en otro lugar). |
| Errores de clave duplicada al cargar | La base destino no estaba vacía. | `scripts/etl-reset.sh` antes de cada corrida. |
| `Por seguridad la base de ensayo debe tener 'etl' en el nombre` | `ETL_DB_NAME` apunta a otra base. | Usa un nombre con "etl"; el script se niega a borrar otra base. |
| La 2.0 no abre el respaldo de `-output-dir` | Se generó con otra `APP_ENCRYPTION_KEY`. | Corre el ETL con la misma llave de la instalación destino, o usa `ETL_OUTPUT_PASSPHRASE`. |
| "guardia de alguien que no viene en la exportación" | El usuario fue borrado en el legacy. | Esperado: el reporte lo informa y esas guardias no se cargan. |
