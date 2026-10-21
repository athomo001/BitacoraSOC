-- GLPI en la Ticketera, fase 2 (10d.2, spec/18 §4; diseño aprobado por el
-- dueño 2026-10-21, <https://claude.ai/artifact/Pju4VRF871FM2jcSqSocG3>):
-- comentar los tickets de GLPI desde la app y «Crear en GLPI» desde un
-- ticket de la app o una entrada de la Bitácora.

-- Escribir en GLPI: apagado por defecto, con un User-Token aparte del de solo
-- lectura. Al crear: cliente → entidad y área → grupo cuando hay más de uno.
ALTER TABLE glpi_config
  ADD COLUMN write_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN write_token_encrypted TEXT,
  ADD COLUMN write_default_type INT NOT NULL DEFAULT 1 CHECK (write_default_type IN (1, 2)),
  ADD COLUMN client_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN area_groups JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN write_failure_notified_on DATE;

-- La copia en GLPI de un ticket de la app: los seguimientos van y vuelven.
ALTER TABLE tickets
  ADD COLUMN glpi_copy_id INT,
  ADD COLUMN glpi_copy_date_mod TEXT,
  ADD COLUMN glpi_copy_synced_at TIMESTAMPTZ;
CREATE UNIQUE INDEX uq_tickets_glpi_copy ON tickets(glpi_copy_id) WHERE glpi_copy_id IS NOT NULL;

-- Estado del envío a GLPI de un comentario escrito en la app.
ALTER TABLE ticket_comments
  ADD COLUMN glpi_push_state TEXT CHECK (glpi_push_state IN ('queued', 'sent', 'failed')),
  ADD COLUMN glpi_push_error TEXT;
ALTER TABLE entry_comments
  ADD COLUMN glpi_followup_id INT,
  ADD COLUMN glpi_push_state TEXT CHECK (glpi_push_state IN ('queued', 'sent', 'failed')),
  ADD COLUMN glpi_push_error TEXT;

-- Cola de envíos a GLPI: un seguimiento, o resolver, cerrar o reabrir la
-- copia. Se reintenta hasta 24 horas; la procesa un solo nodo a la vez
-- (locked_until).
CREATE TABLE glpi_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('followup', 'solve', 'close', 'reopen')),
  glpi_ticket_id INT NOT NULL,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  ticket_comment_id UUID REFERENCES ticket_comments(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
  entry_comment_id UUID REFERENCES entry_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  is_private BOOLEAN NOT NULL DEFAULT true,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sent', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  glpi_item_id INT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);
CREATE INDEX idx_glpi_outbox_due ON glpi_outbox(next_attempt_at) WHERE state = 'queued';
CREATE INDEX idx_glpi_outbox_created ON glpi_outbox(created_at DESC);
