ALTER TABLE work_shifts
  DROP COLUMN IF EXISTS email_subject_template,
  DROP COLUMN IF EXISTS email_include_entries,
  DROP COLUMN IF EXISTS email_include_checklist;
