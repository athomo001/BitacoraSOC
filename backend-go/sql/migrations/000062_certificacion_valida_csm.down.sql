CREATE TABLE goal_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INT CHECK (size_bytes <= 10485760),
  file_data BYTEA,
  url TEXT CHECK (url IS NULL OR length(url) <= 500),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_goal_evidence_kind CHECK ((file_data IS NULL) <> (url IS NULL))
);
CREATE INDEX idx_goal_evidence_goal ON goal_evidence(goal_id, created_at DESC);
ALTER TABLE goals DROP COLUMN validated_by, DROP COLUMN validated_at;
ALTER TABLE goals RENAME COLUMN validation_required TO evidence_required;
