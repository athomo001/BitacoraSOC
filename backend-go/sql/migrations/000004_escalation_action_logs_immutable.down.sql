DROP TRIGGER IF EXISTS trg_escalation_action_logs_immutable ON escalation_action_logs;
DROP FUNCTION IF EXISTS forbid_escalation_action_log_changes();
