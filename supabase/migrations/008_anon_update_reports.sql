-- reports テーブル: anon UPDATE ポリシーを追加
-- 業者（anon）が自分の担当案件の報告書を更新できるようにする
CREATE POLICY "anon_update_reports" ON reports
  FOR UPDATE TO anon
  USING (
    EXISTS (SELECT 1 FROM cases WHERE cases.id = reports.case_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM cases WHERE cases.id = reports.case_id)
  );
