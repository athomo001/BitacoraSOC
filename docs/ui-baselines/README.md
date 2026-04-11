# Baseline visual (UI-QA-059)

Este directorio puede usarse para **capturas opcionales** de regresión visual (no son obligatorias en el repo si el equipo prefiere adjuntarlas solo al PR).

## Qué capturar

Lista canónica de rutas y **5 temas** (`light`, `dark`, `sepia`, `pastel`, `cyberpunk`): ver `docs/UI-GOVERNANCE.md` **§6 — Baseline visual**.

## Convención sugerida

- Carpeta por release o por PR: p. ej. `docs/ui-baselines/2026-04-10-light/` o artefacto de CI.
- Nombre de archivo: `{ruta-simplificada}__{tema}.png` (ej. `report-generator__dark.png`).

## Criterio de “OK”

Misma jerarquía visual, contraste legible y sin roturas de layout; anotar en el PR qué rutas y temas se revisaron (alineado con **QA-UI-062** / **QA-UI-065**).
