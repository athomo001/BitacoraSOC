---
status: accepted
---

# La reescritura vive en el mismo repo, en carpetas nuevas

El repo actual ya tiene `backend/` (Node/Express legacy) y `frontend/` (Angular legacy) ocupados, y hacía falta decidir dónde vive el código Go/Angular 22 del rewrite antes de empezar la Fase 2. Se consideró un repositorio separado (más limpio para el corte final, pero pierde trazabilidad de commits junto al código que reemplaza y complica referenciar archivos legacy durante la migración) contra mantener todo en el mismo repo — **decisión del dueño: mismo repo**. `backend-go/` (módulo Go: `cmd/`, `internal/`, `sql/`) y `frontend-v2/` (Angular 22, desde la Fase 3) viven a la raíz junto al `backend/`/`frontend/` legacy, que se retiran recién en la Fase 14 (corte). El stack nuevo se despliega con `docker-compose.rewrite.yml`, separado del `docker-compose.yml` de producción, en puertos distintos (`8081`/`25432` vs `3000`/`27018`) para poder correr ambos stacks en paralelo durante todo el desarrollo sin interferencia.
