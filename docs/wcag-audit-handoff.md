# WCAG 2.1 AA — handoff de ejecución (UI-A11Y-050)

Los **criterios** y la **checklist** viven en `docs/UI-GOVERNANCE.md` §7. Este archivo fija el **ritmo de ejecución** por release o PR que toque UI:

1. Por cada tema (`light`, `dark`, `sepia`, `pastel`, `cyberpunk`), abrir al menos las rutas de la tabla §6 de la guía.
2. Ejecutar **axe DevTools** (o Lighthouse accesibilidad) y anotar violaciones por tema.
3. Corregir o enlazar issue; en PR, una línea: rutas + temas revisados.

La **última pasada formal** queda como evidencia en el PR o en hoja de equipo; no es obligatorio versionar capturas en el repo (ver **UI-QA-059**).
