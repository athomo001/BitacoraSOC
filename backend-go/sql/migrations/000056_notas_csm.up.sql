-- Notas internas del CSM (spec/16 §4.7.1; diseño aprobado por el dueño
-- 2026-10-21, <https://claude.ai/artifact/TyqgmuG81PEdVxd39jvXFG>): notas
-- sobre la cuenta en la ficha del cliente de Gestión que solo ve el perfil
-- Gestión (ni el admin ni las jefaturas de otras áreas). Edita y borra el
-- autor; fijar, cualquiera de CSM.
CREATE TABLE client_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 5000),
  pinned BOOLEAN NOT NULL DEFAULT false,
  pinned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  pinned_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_notes_client ON client_notes(client_id, pinned DESC, created_at DESC);
