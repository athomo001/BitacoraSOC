-- Varias imágenes por comentario de ticket (comentario del dueño #14).
-- Se suben antes de publicar el comentario (comment_id NULL) y el comentario
-- las reclama; en Postgres como entry_attachments (sin archivos locales, HA).
CREATE TABLE ticket_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES ticket_comments(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  file_data BYTEA NOT NULL,
  hash_sha256 TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ticket_image_size CHECK (size_bytes <= 5242880)
);
CREATE INDEX idx_ticket_images_ticket ON ticket_images(ticket_id, created_at DESC);
CREATE INDEX idx_ticket_images_comment ON ticket_images(comment_id);
