-- ============================================================
-- 009_anon_read_vendors.sql
-- 業者（anon）が案件フォームページで vendors テーブルを読めるように許可
-- 002 で properties/clients は既に許可済み。vendors のみ漏れていた。
-- ============================================================

CREATE POLICY "anon_select_vendors" ON vendors
  FOR SELECT TO anon
  USING (true);
