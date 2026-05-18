# Gobernanza UI — Bitácora SOC

Documento operativo asociado principalmente a **UI-GOV-058** (entregable “guía publicada”). Los issues **`UI-CHK-044` … `UI-MIG-060`** y la remediación visual **`UI-VIS-066`..`071`** figuran como **Listos** en `docs/ISSUES.md` (cierre de tabla 2026-04-10 / 2026-04-11). Obligaciones por PR: **`QA-UI-061`–`065`** (**Recurrente**). Mejora continua: **§9** (`!important`, hex, reconteos) y **`docs/wcag-audit-handoff.md`**. El epic **`AI-SUMMARY-001` … `001G`** no se prioriza aquí: ver `ISSUES.md` → *Tablas de Control*.

## 1. Fuentes de verdad

| Recurso | Uso |
| --- | --- |
| `frontend/src/styles/semantic-tokens.scss` | Tokens `--surface-*`, `--outline-*`, `--space-*`, `--radius-*`, `--audit-cat-*`, tipografía semántica |
| `frontend/src/styles.scss` | Overrides globales Material; preferir clase contenedora + selectores acotados antes que `::ng-deep` en componentes |
| `docs/ISSUES.md` | **Listas** = cerrados (incl. `UI-CHK-044`…`UI-MIG-060` y `UI-VIS-066`..`071`); **En progreso** = nuevos `UI-*` cuando se abran; **Recurrente** = QA por PR; **Archivo IA** = epic IA sin priorización operativa |

## 2. Backlog UI/QA (misma fuente que `ISSUES.md`)

`docs/ISSUES.md` manda. El cierre **`UI-CHK-044` … `UI-MIG-060`** y **`UI-VIS-066`..`071`** permanece en **Listas**; la tabla **En progreso** queda para nuevas olas.

**Resumen de lo cerrado (2026-04-10):** checklist admin (asistente + guardado único), sin `mat-card` contenedor en rutas core (oleadas 1–11), tokens/hex en app acotados a CRT, sin `::ng-deep` en SCSS de app, baseline §6, handoff WCAG en `docs/wcag-audit-handoff.md`, `!important` remanente solo en overrides globales (métrica §9).

### Recurrente (cada PR con UI)

| ID | Obligación |
| --- | --- |
| `QA-UI-061` | Quien toca UI actúa como QA; no cerrar solo con “compila”. |
| `QA-UI-062` | Probar **5 temas** en rutas tocadas; anotar en PR qué se probó. |
| `QA-UI-063` | Regresión formularios (labels, errores, disabled, tablas, paginador). |
| `QA-UI-064` | Contraste texto/fondo, inputs, placeholders, hover/focus, chips/badges. |
| `QA-UI-065` | No saltarse estos estándares “por ir rápido”; evidencia o checklist en PR. |

**IA:** `AI-SUMMARY-001` … `001G` están en `ISSUES.md` como **archivo de referencia**; **no** entran en §2 como trabajo operativo.

## 3. Reglas de implementación

1. **Color:** en vistas funcionales, evitar `#hex` sueltos; usar `var(--…)` del tema o tokens semánticos.
2. **Contención visual (regla del programa, antes UI-ARCH-045):** como norma, **máximo dos niveles** legibles de “caja” por pantalla (superficie de página + bloque funcional). Evitar `mat-card` anidada solo por decoración; preferir secciones con título, borde sutil o `--surface-variant`.
3. **Estados:** reutilizar clases globales (`badge-pill`, `badge-surface-success|warning|error|info|neutral`, etc.) en lugar de duplicar estilos por módulo.
4. **Angular Material:** no añadir `::ng-deep` en componentes; subir a `styles.scss` con prefijo de clase en el template (`catalog-tabs`, `reports-period-toggle`, etc.).
5. **Accesibilidad:** respetar `prefers-reduced-motion` en animaciones decorativas; mantener foco visible en controles custom.

## 4. Layout estándar admin (regla viva; antes UI-LAYOUT-053)

Orden recomendado por pantalla de administración:

1. **Cabecera de contexto** (título + una línea de descripción).
2. **Barra de acciones primaria** (un botón principal claro por contexto cuando sea posible).
3. **Filtros** (opcional, agrupados).
4. **Contenido principal** (tabla, formulario o maestro-detalle).

Patrones ya alineados en el código: `page-header` + `admin-section` + `admin-section__toolbar` (p. ej. checklist-admin, catálogos).

## 5. Densidad (regla viva; antes UI-DENS-054)

- Usar escala `--space-1` … `--space-6` para gaps y padding de sección.
- En viewports &lt; 960px, reducir padding lateral del contenedor y priorizar scroll vertical sobre columnas estrechas paralelas.
- Tablas: envolver en `.table-responsive` o equivalente cuando haya muchas columnas.

## 6. Baseline visual (regla viva; antes UI-QA-059)

No se exigen capturas en el repo por defecto; sí se define **qué** revisar al cambiar estilos o tokens. Opcional: convención y carpeta en `docs/ui-baselines/README.md`.

| Ruta / área | Temas |
| --- | --- |
| Login (CRT + infoflow si aplica) | 5 |
| `/main/report-generator` | 5 |
| `/main/admin/checklist` | 5 |
| `/main/admin/catalogs` | 5 |
| `/main/audit-logs` | 5 |
| Layout principal (menú, tema, barra salud) | 5 |

**Tema:** `light`, `dark`, `sepia`, `pastel`, `cyberpunk` (`data-theme` en documento).

Guardar capturas en artefacto de PR o carpeta de equipo si se requiere evidencia formal.

## 7. Contraste y WCAG (QA-UI-064 + `docs/wcag-audit-handoff.md`)

- Objetivo: **WCAG 2.1 AA** donde aplique (texto normal ≥ 4.5:1; texto grande ≥ 3:1).
- Comprobar: texto principal y secundario sobre `--background-color` y `--surface-color` / `--surface-card`; placeholders y hints; estados hover/focus/disabled en `mat-form-field`.
- Herramientas sugeridas: inspector del navegador, **WebAIM Contrast Checker**, **axe DevTools** (o similar).

**Pasada sugerida (registro en PR o hoja de hallazgos):**

1. Por cada tema, abrir al menos las rutas de la tabla **§6** y ejecutar **axe** (o Lighthouse accesibilidad) en una vista representativa.
2. Anotar violaciones por tema (ID regla, selector aproximado, captura si aplica).
3. Priorizar: contraste texto/fondo, foco visible, nombres accesibles en icon-buttons sin `aria-label`.
4. Corregir o crear issue enlazado; registrar en PR qué temas/rutas se pasaron con herramienta.

## 8. Obligaciones QA por cambio UI (QA-UI-061 a QA-UI-065)

No son cierres únicos: aplican **cada vez** que se modifique CSS, tokens o maquetación.

| ID | Obligación |
| --- | --- |
| **QA-UI-061** | Actuar como **QA**: legibilidad, errores, foco, flujos reales; la interfaz debe ser usable en condiciones SOC, no solo compilar. |
| **QA-UI-062** | Tras tocar `styles.scss`, `semantic-tokens.scss` o SCSS de pantalla: probar la ruta en **light, dark, sepia, pastel, cyberpunk**. Documentar en PR qué rutas y temas se probaron. |
| **QA-UI-063** | Regresión de **formularios**: labels, hints/errores, `touched`/`invalid`, selects, diálogos, tablas, paginador; nada que parezca deshabilitado sin estarlo (o al revés). |
| **QA-UI-064** | **Contraste y theming:** texto vs fondo de página y card; `mat-form-field` / textarea / input (fondo, borde, texto, placeholder) en 5 temas; hover/focus/disabled; tooltips, chips y badges sobre superficies claras y oscuras. |
| **QA-UI-065** | **Gobernanza:** estos puntos no se omiten al codificar; merge con evidencia (checklist marcado o línea en PR). |

### Checklist mínimo antes de dar por cerrado el cambio

- [ ] **QA-UI-062:** vista afectada en los **5 temas**.
- [ ] **QA-UI-063:** formularios y controles de la zona tocada revisados.
- [ ] **QA-UI-064:** sin combinaciones ilegibles (texto/fondo/inputs).
- [ ] **QA-UI-065:** PR o release note con una línea: rutas + temas probados.
- [ ] Sin regresión obvia en rutas de la tabla **§6** (smoke visual).

## 9. Métricas de deuda UI (mejora continua; histórico UI-MIG-060 / UI-MAT-052)

**Reconteo tras cada lote** (desde raíz del repo, con [ripgrep](https://github.com/BurntSushi/ripgrep) instalado):

```bash
rg "!important" frontend/src/styles.scss --count-matches
rg "::ng-deep" frontend/src/app --glob "*.scss"
rg "#[0-9a-fA-F]{3,8}" frontend/src/app --glob "*.scss" | head -80
```

El tercer comando es muestra orientativa; para **hex por carpeta**: `rg "#[0-9a-fA-F]{3,8}" frontend/src/app/pages --glob "*.scss" --stats`. Excluir manualmente valores en comentarios o datos dinámicos justificados (**UI-COLOR-049** / **§11**).

Instantánea **2026-04-10** (actualizar al cerrar lotes):

| Métrica | Valor (aprox.) | Nota |
| --- | --- | --- |
| `!important` en `frontend/src/styles.scss` | ~100 | Objetivo: bajar con theming Material y mayor especificidad sin `!important`. Recontar con `rg '!important' styles.scss`. |
| `::ng-deep` en `frontend/src/app/**/*.scss` | 0 usos activos | Comentarios en catálogos no cuentan. |
| Oleadas cualitativas | 11 | Ver lista siguiente. |

Oleadas ya aplicadas en código:

1. Report-generator — tokens, globos de ayuda, correo sin inline fijo en panel operativo.
2. Checklist-admin — secciones numeradas, paneles `.admin-panel` (sin `mat-card` en bloques principales), sticky, tabla responsive, badges globales.
3. Catalog-admin — tabs Material globales, badges reglas.
4. Audit-logs — categorías vía `--audit-cat-*`.
5. Main-layout — acordeón, menú, chips salud con tokens.
6. Cabeceras admin con gradiente — `escalation-admin-simple`, `escalation-simple`, `work-shifts-admin`: `<header class="page-header">` sin `mat-card` (UI-ARCH-045).
7. `report-generator` — contenedor `.report-generator-panel` sin `mat-card` raíz; checklist recordatorios — apilado móvil &lt; 640px (UI-ARCH-045 / UI-CHK-044).
8. `admin-security` / `admin-appearance` — panel tokenizado sin `mat-card` raíz; **login CRT** — `$crt-neon`, `$crt-danger`, uso de `$crt-text` (UI-ARCH-045 / UI-LAYOUT-053 / UI-LOGIN-055 / UI-COLOR-049).
9. **Lote pantallas core:** `settings`, `integrations`, `users`, `entries`, `profile`, `audit-logs`, `work-shifts-admin` (form + panel lista), `forgot-password`, `reset-password` — paneles semánticos sin `mat-card` contenedor (v1.5.39-beta).
10. **`backup`** / **`logo` (Branding)** — `.backup-panel` / `.logo-panel` sin `mat-card` (v1.5.40-beta).
11. **`reports`**, **`all-entries`**, **`catalog-admin`**, **`checklist`** (operador), **`glpi-integration`**, **`escalation-simple`** / **`escalation-admin-simple`** (`<section>` formularios), **`admin-complements`**, **`current-shift`**, legado **`escalation-view`** / **`escalation-admin`** — paneles tokenizados; **`MatCardModule`** retirado de `main.module.ts` si no hay templates con `mat-card` (v1.5.42-beta).

## 10. Clases globales de estado (regla viva; antes UI-COMP-048)

No hay paquete Angular aparte: el “shared set” vive en `styles.scss` y `semantic-tokens.scss`.

| Clase | Uso |
| --- | --- |
| `.badge-pill` | Forma base pill |
| `.badge-pill-muted` | Variante discreta |
| `.badge-surface-success` / `warning` / `error` / `info` / `neutral` | Combinar con `.badge-pill` para semántica |

Preferir estas clases antes de inventar badges locales por pantalla.

## 11. Excepciones a “sin inline” (regla viva; antes UI-REF-051)

Está bien usar **`[style.*]`** cuando el valor es **dato dinámico** del modelo (no tema):

- Heatmap en `/main/reports`: color de celda según valor.
- Selector de color en catálogos y turnos: muestra del HEX elegido por el usuario.

El issue sigue siendo relevante para **estilos estáticos** en HTML (mover a SCSS con tokens).

---

*Última actualización: 2026-05-18 — documento vigente para gobernanza UI/QA; obligaciones Recurrente (`QA-UI-061` a `QA-UI-065`) y métricas de §9 se mantienen activas.*
