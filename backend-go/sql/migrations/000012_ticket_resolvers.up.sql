-- Varios resolutores por ticket (comentario del dueño #13): quien toma el
-- ticket queda como resolutor y después se pueden agregar o quitar más.
-- tickets.assigned_user_id sigue siendo el responsable principal.
CREATE TABLE ticket_resolvers (
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);
CREATE INDEX idx_ticket_resolvers_user ON ticket_resolvers(user_id);

-- Los tickets ya asignados conservan a su responsable como resolutor.
INSERT INTO ticket_resolvers (ticket_id, user_id)
SELECT id, assigned_user_id FROM tickets WHERE assigned_user_id IS NOT NULL;
