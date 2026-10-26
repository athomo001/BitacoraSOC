-- Complementos que agregan funciones a la app (pendiente 10i, spec/11 §12;
-- decisiones del dueño y diseño aprobado el 2026-10-26,
-- <https://claude.ai/artifact/FwDwV5LL1txKrM6UZBQUEj>).

-- complement.json del complemento (lo que declara) y lo que el admin aprobó,
-- cosa por cosa («page:informe», «data:entries:read», «topbar»…). Lo que una
-- versión nueva agrega queda sin aprobar hasta que el admin lo revise.
-- «De la casa» habilita la barra superior y las páginas en Administración.
-- La configuración guarda en settings lo común y en secrets_encrypted (la
-- caja de la contraseña SMTP) los campos secretos. La llave de integraciones
-- y el secreto de los ganchos se guardan cifrados para que el servicio los
-- pida con su token de aplicación.
ALTER TABLE complements
  ADD COLUMN manifest JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN approved TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN is_house BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN secrets_encrypted TEXT,
  ADD COLUMN integration_key_encrypted TEXT,
  ADD COLUMN hook_secret_encrypted TEXT;

-- La llave de la API de integraciones de un complemento con servidor
-- (§12.3): se crea al aprobar sus permisos de datos y cae con él.
ALTER TABLE api_keys ADD COLUMN complement_id UUID REFERENCES complements(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_api_keys_complement ON api_keys(complement_id) WHERE complement_id IS NOT NULL AND active;

-- Los ganchos a eventos reutilizan la cola de la 10b: el complemento es un
-- destino HTTP interno más, que recibe solo los eventos aprobados (events),
-- firmados con HMAC. No se muestra en Administración → Integraciones.
ALTER TABLE forward_destinations
  ADD COLUMN complement_id UUID REFERENCES complements(id) ON DELETE CASCADE,
  ADD COLUMN events TEXT[],
  ADD COLUMN hmac_secret_encrypted TEXT;
CREATE UNIQUE INDEX idx_forward_destinations_complement ON forward_destinations(complement_id) WHERE complement_id IS NOT NULL;

-- Tareas programadas aprobadas: la app llama POST <servicio>/hooks/schedule/<nombre>.
-- Un solo nodo la dispara (préstamo de 2 minutos, como el reenvío).
CREATE TABLE complement_schedules (
  complement_id UUID NOT NULL REFERENCES complements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  next_run_at TIMESTAMPTZ NOT NULL,
  lease_until TIMESTAMPTZ,
  lease_owner TEXT,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  PRIMARY KEY (complement_id, name)
);
CREATE INDEX idx_complement_schedules_due ON complement_schedules(next_run_at);

-- Seguimientos que deja un complemento (ADD_NOTE) o una llave de la API:
-- se firman «persona, con <complemento>». En los tickets va en
-- ticket_comments.origin como 'complement:<nombre>'.
ALTER TABLE entry_comments ADD COLUMN via TEXT;
