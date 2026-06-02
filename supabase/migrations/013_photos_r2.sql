-- 写真をR2へ移行するための列を追加。
-- storage_path(既存=Supabase Storage) は残置し、storage 列で supabase/r2 を併存させる。
ALTER TABLE report_photos ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE report_photos ADD COLUMN IF NOT EXISTS storage     text DEFAULT 'r2';

-- 既存行はSupabase Storage扱いに固定（過去分の表示が壊れないように）
UPDATE report_photos SET storage = 'supabase' WHERE storage_key IS NULL AND storage_path IS NOT NULL;

-- 新規はstorage_keyを使うため storage_path のNOT NULL制約を外す
ALTER TABLE report_photos ALTER COLUMN storage_path DROP NOT NULL;
