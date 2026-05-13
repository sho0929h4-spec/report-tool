ALTER TABLE cases   ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS checklist jsonb;
