-- ============================================================
-- 003_schedule_submissions.sql
-- 入居者の候補日程を管理するテーブル
-- ============================================================

CREATE TABLE schedule_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  slots        jsonb NOT NULL DEFAULT '[]',
  -- slots format: [{"date":"2026-05-10","period":"午前（9〜12時）"}]
  note         text,
  submitted_at timestamptz DEFAULT now()
);

CREATE INDEX idx_schedule_case_id ON schedule_submissions(case_id);

ALTER TABLE schedule_submissions ENABLE ROW LEVEL SECURITY;

-- 管理者（authenticated）: 全操作
CREATE POLICY "admin_all_schedule" ON schedule_submissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- anon: 案件が存在する場合のみ INSERT
CREATE POLICY "anon_insert_schedule" ON schedule_submissions
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (SELECT 1 FROM cases WHERE cases.id = schedule_submissions.case_id)
  );

-- anon: SELECT（業者フォームで候補日を表示するため）
CREATE POLICY "anon_select_schedule" ON schedule_submissions
  FOR SELECT TO anon USING (true);
