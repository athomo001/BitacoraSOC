-- Reenvío de eventos a un SIEM y API de integraciones (pendiente 10b,
-- spec/19; diseño aprobado por el dueño 2026-10-21,
-- <https://claude.ai/artifact/Qra3CSJqouUWn4KkftWpkh>).

-- Destinos del reenvío (§3.1): syslog UDP/TCP/TLS o HTTP. Cada uno elige
-- qué grupos recibe y lleva su cursor sobre forward_outbox. Los secretos
-- (llave del cliente mTLS, valores de las cabeceras HTTP) van cifrados con
-- la misma caja que la contraseña SMTP.
CREATE TABLE forward_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  transport TEXT NOT NULL CHECK (transport IN ('udp', 'tcp', 'tls', 'http')),
  host TEXT,
  port INT CHECK (port BETWEEN 1 AND 65535),
  url TEXT,
  format TEXT NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'rfc5424')),
  batch BOOLEAN NOT NULL DEFAULT false,
  send_audit BOOLEAN NOT NULL DEFAULT true,
  audit_level TEXT NOT NULL DEFAULT 'info' CHECK (audit_level IN ('info', 'warn', 'error')),
  send_entries BOOLEAN NOT NULL DEFAULT false,
  send_escalation BOOLEAN NOT NULL DEFAULT false,
  send_tickets BOOLEAN NOT NULL DEFAULT false,
  ca_cert TEXT,
  client_cert TEXT,
  client_key_encrypted TEXT,
  header_names TEXT[] NOT NULL DEFAULT '{}',
  headers_encrypted TEXT,
  cursor_id BIGINT NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ,
  lease_owner TEXT,
  next_attempt_at TIMESTAMPTZ,
  failures INT NOT NULL DEFAULT 0,
  failing_since TIMESTAMPTZ,
  down_alerted BOOLEAN NOT NULL DEFAULT false,
  last_sent_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cola persistente (§3.3): cada evento queda aquí al registrarse; los
-- destinos avanzan su cursor. Se purga lo que ya pasaron todos y lo de más
-- de 7 días.
CREATE TABLE forward_outbox (
  id BIGSERIAL PRIMARY KEY,
  grp TEXT NOT NULL CHECK (grp IN ('audit', 'entries', 'escalation', 'tickets')),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_forward_outbox_created ON forward_outbox(created_at);

-- Cifras por día de cada destino: enviados y perdidos (más de 7 días en cola).
CREATE TABLE forward_stats (
  destination_id UUID NOT NULL REFERENCES forward_destinations(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  sent INT NOT NULL DEFAULT 0,
  lost INT NOT NULL DEFAULT 0,
  PRIMARY KEY (destination_id, day)
);

-- Llaves de la API de integraciones (§4.1). La tabla ya existía sin uso:
-- se suman para qué sirve, clientes (NULL = todos), área de los tickets que
-- crea y la revocación.
ALTER TABLE api_keys
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN client_ids UUID[],
  ADD COLUMN area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD COLUMN revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN revoke_reason TEXT;
CREATE INDEX idx_api_keys_created_by ON api_keys(created_by);

-- Registro de llamadas (§4.4), 90 días; incluye las de llave inválida.
CREATE TABLE api_key_requests (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  key_prefix TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  scope TEXT,
  status INT NOT NULL,
  latency_ms INT NOT NULL,
  ip TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_key_requests_key ON api_key_requests(api_key_id, created_at DESC);
CREATE INDEX idx_api_key_requests_created ON api_key_requests(created_at);

-- Reintentos seguros (Idempotency-Key), 24 horas. status 0 = en curso.
CREATE TABLE api_idempotency (
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INT NOT NULL DEFAULT 0,
  body BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, idem_key)
);
CREATE INDEX idx_api_idempotency_created ON api_idempotency(created_at);

-- Marca «API · nombre de la llave» en lo que crea una llave.
ALTER TABLE entries
  ADD COLUMN api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  ADD COLUMN api_key_name TEXT;
ALTER TABLE tickets
  ADD COLUMN api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  ADD COLUMN api_key_name TEXT;
