-- Seguimiento de entradas de la Bitácora (pendiente 10j, spec/12; idea del
-- dueño 2026-10-21). Una entrada con seguimiento queda «En seguimiento» hasta
-- que alguien la cierra; así se encuentra días después con el filtro, sin
-- buscarla a mano.
ALTER TABLE entries
  ADD COLUMN follow_up_open BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN follow_up_closed_at TIMESTAMPTZ,
  ADD COLUMN follow_up_closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN follow_up_close_note TEXT;
CREATE INDEX idx_entries_follow_up_open ON entries(created_at DESC) WHERE follow_up_open;

-- El buscador también mira el texto de los seguimientos.
CREATE INDEX idx_entry_comments_fulltext ON entry_comments USING GIN(to_tsvector('spanish', comment));

-- Lo que tuvo seguimiento en la última semana parte abierto; lo anterior no,
-- para que el día que se activa no aparezca todo el historial.
UPDATE entries e SET follow_up_open = true
WHERE EXISTS (SELECT 1 FROM entry_comments c WHERE c.entry_id = e.id AND c.created_at > now() - interval '7 days');
