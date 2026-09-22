---
status: accepted
---

# Design system: Geist Sans + JetBrains Mono sobre paleta grafito/OLED, se descarta Inter

El legacy usa Indigo/Roboto (Angular Material por defecto). El rewrite fija un design system nuevo: paleta industrial grafito/OLED con semáforo operativo de estado (`--status-ok/warning/critical/carrier/system`, `06-frontend-arquitectura-y-ui.md`), y **`Geist Sans`** (Vercel + Basement Studio, SIL OFL, auto-hospedada) en vez de `Inter` para texto de UI — decisión puntual tomada después de fijar la paleta: `Inter` se convirtió en 2026 en el "tell" #1 citado en discusión de diseño para reconocer productos hechos por IA, justo lo opuesto al mandato "cero visual de IA" de este proyecto. `JetBrains Mono` se mantiene para IPs/circuitos/timestamps. Es una decisión cara de revertir una vez que decenas de componentes queden construidos sobre estos tokens (fuente, paleta, contraste WCAG AAA), y contra-intuitiva sin este contexto (alguien podría "corregir" de vuelta a Inter por ser la elección más común). Los 6 skins de login legacy (CRT, Cyber/Matrix, Surrealismo, Win 3.11, Unix 89, Modern) se conservan como variables sobre un único componente, no como una reescritura de la identidad visual completa.
