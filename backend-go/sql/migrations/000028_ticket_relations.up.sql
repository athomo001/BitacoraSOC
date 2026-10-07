-- 000028: unir tickets duplicados y tickets padre/hijo (pedido del dueño
-- 2026-10-07, canvas "Ticketera: unir y padre/hijo").
-- parent_id: un solo nivel (un padre no tiene padre; un hijo no tiene hijos),
-- lo valida el servidor. merged_into_id: el ticket que se unió a otro queda
-- cerrado apuntando al principal; su historial se movió a ese principal.
ALTER TABLE tickets
  ADD COLUMN parent_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  ADD COLUMN merged_into_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_ticket_parent_self CHECK (parent_id IS NULL OR parent_id <> id),
  ADD CONSTRAINT chk_ticket_merged_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);
CREATE INDEX idx_tickets_parent ON tickets(parent_id) WHERE parent_id IS NOT NULL;

-- De dónde viene un comentario: '' (propio), 'parent:TKT-…' (copiado del
-- padre), 'child:TKT-…' (aviso de un hijo), 'merged:TKT-…' (de un ticket unido).
ALTER TABLE ticket_comments ADD COLUMN origin TEXT NOT NULL DEFAULT '';
