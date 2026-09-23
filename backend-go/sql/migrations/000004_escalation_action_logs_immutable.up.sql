-- Fase 7: escalation_action_logs es el registro fehaciente de cada intento de
-- contacto ("escudo del operador" ante reclamos de SLA, HU-1t). El esquema
-- inicial lo decía en un comentario, pero nada impedía un UPDATE o DELETE:
-- este trigger lo hace cumplir en la propia base, sin depender de que el
-- código de la aplicación se porte bien. Una corrección se registra como un
-- intento nuevo, nunca editando uno anterior.
CREATE OR REPLACE FUNCTION forbid_escalation_action_log_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'escalation_action_logs es inmutable: no se permite % (registra un intento nuevo en su lugar)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_escalation_action_logs_immutable
  BEFORE UPDATE OR DELETE ON escalation_action_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_escalation_action_log_changes();
