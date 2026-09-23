-- Búsqueda del directorio sin tildes (Fase 6): los analistas buscan "Perez"
-- y el contacto se llama "Pérez". unaccent viene en el contrib estándar de
-- Postgres (incluido en la imagen oficial postgres:18).
CREATE EXTENSION IF NOT EXISTS unaccent;
