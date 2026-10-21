-- Metas para alguien sin cuenta (decisión del dueño, 2026-10-21): la persona
-- se escribe a mano (nombre y correo), solo como registro. Si después se crea
-- un usuario con ese correo, la meta y su historial pasan a su cuenta.

ALTER TABLE goals
  ADD COLUMN person_name TEXT CHECK (length(trim(person_name)) BETWEEN 1 AND 120),
  ADD COLUMN person_email TEXT CHECK (length(person_email) BETWEEN 3 AND 254);

ALTER TABLE goals DROP CONSTRAINT chk_goal_scope;
ALTER TABLE goals ADD CONSTRAINT chk_goal_scope CHECK (
  (scope = 'client' AND client_id IS NOT NULL AND person_user_id IS NULL AND person_email IS NULL) OR
  (scope = 'area' AND area_id IS NOT NULL AND client_id IS NULL AND person_user_id IS NULL AND person_email IS NULL) OR
  (scope = 'person' AND client_id IS NULL AND area_id IS NULL AND
    ((person_user_id IS NOT NULL AND person_name IS NULL AND person_email IS NULL) OR
     (person_user_id IS NULL AND person_name IS NOT NULL AND person_email IS NOT NULL))));

CREATE INDEX idx_goals_person_email ON goals (lower(person_email)) WHERE person_email IS NOT NULL;

-- Al crear un usuario (o cambiarle el correo) desde donde sea —Administración,
-- el ETL o un respaldo—, sus metas escritas a mano pasan a su cuenta.
CREATE FUNCTION link_goals_to_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH linked AS (
    UPDATE goals SET person_user_id = NEW.id, owner_user_id = NEW.id, person_name = NULL, person_email = NULL, updated_at = now()
    WHERE scope = 'person' AND person_user_id IS NULL AND lower(person_email) = lower(NEW.email)
    RETURNING id
  )
  INSERT INTO goal_events (goal_id, text, user_id)
  SELECT id, 'Pasó a la cuenta de ' || COALESCE(NULLIF(NEW.full_name, ''), NEW.username), NULL FROM linked;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_users_link_goals AFTER INSERT OR UPDATE OF email ON users
  FOR EACH ROW EXECUTE FUNCTION link_goals_to_user();
