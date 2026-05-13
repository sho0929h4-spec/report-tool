-- cases: 入居者名
ALTER TABLE cases ADD COLUMN IF NOT EXISTS resident_name text;

-- reports: 漏水状況 + フォローアップ
ALTER TABLE reports ADD COLUMN IF NOT EXISTS leak_status text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS leak_amount text[];
ALTER TABLE reports ADD COLUMN IF NOT EXISTS leak_amount_note text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS estimate_by text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS estimate_by_date date;

-- Storage bucket (存在しない場合のみ作成)
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND schemaname='storage' AND policyname='anon_reports_insert') THEN
    CREATE POLICY "anon_reports_insert" ON storage.objects
      FOR INSERT TO anon WITH CHECK (bucket_id = 'reports');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND schemaname='storage' AND policyname='anon_reports_select') THEN
    CREATE POLICY "anon_reports_select" ON storage.objects
      FOR SELECT TO anon USING (bucket_id = 'reports');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND schemaname='storage' AND policyname='auth_reports_all') THEN
    CREATE POLICY "auth_reports_all" ON storage.objects
      FOR ALL TO authenticated USING (bucket_id = 'reports');
  END IF;
END $$;
