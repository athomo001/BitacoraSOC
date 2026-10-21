DROP INDEX idx_entry_comments_fulltext;
DROP INDEX idx_entries_follow_up_open;
ALTER TABLE entries
  DROP COLUMN follow_up_close_note,
  DROP COLUMN follow_up_closed_by,
  DROP COLUMN follow_up_closed_at,
  DROP COLUMN follow_up_open;
