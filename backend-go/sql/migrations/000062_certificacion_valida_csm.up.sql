-- Certificaciones validadas por la CSM (pedido del dueño 2026-10-23): los
-- certificados ya se guardan en otro sistema, así que la meta ya no pide
-- adjuntar el PDF; la CSM valida la certificación y con eso se cumple.
ALTER TABLE goals RENAME COLUMN evidence_required TO validation_required;
ALTER TABLE goals ADD COLUMN validated_at TIMESTAMPTZ,
  ADD COLUMN validated_by UUID REFERENCES users(id) ON DELETE SET NULL;
-- Las que ya se cumplieron con su certificado quedan validadas (si no, al
-- reconciliar volverían a estar en curso).
UPDATE goals SET validated_at = completed_at, validated_by = completed_by
WHERE validation_required AND completed_at IS NOT NULL;
DROP TABLE goal_evidence;
