---
status: accepted
---

# PostgreSQL reemplaza MongoDB

BitacoraSOC corre en producción 24/7 sobre Node/Express + Mongoose + MongoDB. Al decidir una reescritura completa del backend en Go, se evaluó mantener MongoDB (driver oficial disponible) contra migrar a PostgreSQL. Se eligió **PostgreSQL 18** por tres razones concretas del propio dominio: el motor de escalación unificado necesita jerarquías territoriales reales (`ltree`, no reproducible limpiamente en documentos anidados de Mongo sin duplicación), el modelo de datos del rewrite es fuertemente relacional (organizaciones↔equipos↔cobertura↔políticas de escalación, con integridad referencial real vía FK en vez de validarla a mano en la aplicación), y `sqlc` da SQL tipado en compilación sin el overhead de un ORM pesado. Es una decisión difícil de revertir (toda la capa de datos y `03-esquema-db.sql` dependen de ella) — ver `01-arquitectura.md` para la tabla comparativa completa.
